# Colocating Voice AI Models on EKS

EKS Auto Mode cluster with GPU support for running a voice AI pipeline (LiveKit + Orchestrator + LLM + STT/TTS) across 3 nodes in the same AZ/subnet for low inter-node latency.

## Project Structure

```
├── terraform/              # AWS infrastructure (VPC, EKS, IAM)
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── terraform.tfvars.example
├── helm/livekit/           # LiveKit Server values (official chart override)
│   └── values.yaml                 # hostNetwork, credentials, colocation
├── helm/voice-pipeline/    # Helm chart for the voice AI pipeline
│   ├── Chart.yaml
│   ├── values.yaml                 # Default values (3-node: shared CPU + 2 GPU, same AZ)
│   ├── templates/
│   │   ├── _helpers.tpl            # Shared labels, affinity, tolerations
│   │   ├── llm-deployment.yaml     # vLLM (dedicated GPU node)
│   │   ├── speaches-deployment.yaml # Speaches STT+TTS (dedicated GPU node)
│   │   ├── orchestrator-deployment.yaml # LiveKit Agents orchestrator (CPU node)
│   │   ├── services.yaml           # 3 ClusterIP services
│   │   ├── configmap.yaml          # Endpoint URLs for service discovery
│   │   └── karpenter-nodepool.yaml # GPU node provisioning
│   └── tests/                      # helm-unittest test suites
├── orchestrator/           # LiveKit Agents voice agent (VAD → STT → LLM → TTS)
│   ├── agent.py            # Main entry point — agent worker + pipeline config
│   ├── requirements.txt    # Python dependencies (livekit-agents, openai, silero)
│   └── Dockerfile          # Container image (python:3.11-slim, non-root)
├── client/                 # Browser voice client (Next.js dashboard)
│   ├── app/
│   │   ├── api/token/route.ts      # LiveKit JWT generation (server-side)
│   │   ├── api/health/route.ts     # Readiness/liveness probe endpoint
│   │   ├── hooks/                  # React hooks (useRoom, useLatencyData, etc.)
│   │   ├── components/             # UI components (controls, visualization, etc.)
│   │   ├── page.tsx                # Single-page dashboard
│   │   ├── layout.tsx              # Dark theme layout wrapper
│   │   └── types.ts                # Shared TypeScript interfaces
│   ├── Dockerfile                  # Multi-stage build (node:20-alpine, standalone)
│   ├── .env.local.example          # Required env vars documentation
│   └── package.json
├── k8s/                    # Kubernetes manifests
│   └── nodepools.yaml     # CPU NodePool for LiveKit + Orchestrator
├── flake.nix               # Nix dev environment
└── .envrc                  # direnv activation
```

## Prerequisites

### AWS Permissions

Use an IAM user or role with `AdministratorAccess` for the demo. The infrastructure touches EKS, EC2, IAM, and VPC.

### Service Quota

You need at least **8 vCPUs** of G-instance capacity (two g5.xlarge = 4 vCPUs each).

Check your quota:

```bash
aws service-quotas get-service-quota \
  --service-code ec2 \
  --quota-code L-DB2E81BA \
  --region us-east-1 \
  --query 'Quota.Value'
```

If less than 8, request an increase via the [Service Quotas console](https://console.aws.amazon.com/servicequotas/) → Amazon EC2 → "Running On-Demand G and VT instances".

### CLI Tools

| Tool | Version |
|------|---------|
| AWS CLI | v2 |
| Terraform | >= 1.5 |
| kubectl | v1.31+ |
| Helm | v3 |
| Node.js | v20+ (for browser client) |

If you have Nix + direnv, just run `direnv allow` — the flake provides all tools.

### Hugging Face Token

The voice AI pipeline uses Llama 3.1. You'll need a [Hugging Face token](https://huggingface.co/settings/tokens) with access to [meta-llama/Llama-3.1-8B](https://huggingface.co/meta-llama/Llama-3.1-8B). This isn't needed for infrastructure provisioning — only when deploying the model serving workload later.

### Cost Estimate

| Resource | Cost |
|----------|------|
| 2× g5.xlarge (GPU nodes) | ~$2.14/hr |
| EKS cluster | $0.10/hr |
| 1× CPU node (general-purpose) | ~$0.05/hr |

A full demo session (1-2 hours) costs under $5. Tear down when done.

---

## Deployment

### 1. Configure

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Review `terraform.tfvars` and adjust variables if needed (region, AZ, cluster name). Defaults work out of the box for `us-east-1a`.

### 2. Provision Infrastructure (~15-20 min)

```bash
terraform init
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

Verify the cluster is active:

```bash
aws eks describe-cluster \
  --name $(terraform output -raw cluster_name) \
  --region $(terraform output -raw aws_region) \
  --query "cluster.status" --output text
```

Get ECR from outputs:
```bash
# Get the ECR repository URL from Terraform
ECR_REPO=$(terraform output -raw orchestrator_ecr_repository_url)
```


### 3. Connect to the Cluster

```bash
$(terraform output -raw update_kubeconfig_command)
kubectl cluster-info
```

### 4. Build the Orchestrator Image

The orchestrator is a LiveKit Agents worker that connects STT → LLM → TTS using OpenAI-compatible endpoints (Speaches + vLLM). Build and push the container image to the ECR repository provisioned by Terraform:

```bash
cd ../orchestrator

# Authenticate Docker with ECR
aws ecr get-login-password --region $(cd ../terraform && terraform output -raw aws_region) \
  | docker login --username AWS --password-stdin $(echo $ECR_REPO | cut -d/ -f1)

# Build and push
docker build -t $ECR_REPO:latest .
docker push $ECR_REPO:latest

cd ..
```

The orchestrator reads configuration from environment variables (injected via the Helm chart's ConfigMap):

| Variable | Required | Description |
|----------|----------|-------------|
| `LIVEKIT_URL` | Yes | LiveKit server WebSocket URL |
| `LIVEKIT_API_KEY` | Yes | LiveKit API key |
| `LIVEKIT_API_SECRET` | Yes | LiveKit API secret |
| `STT_BASE_URL` | Yes | Speaches STT endpoint |
| `TTS_BASE_URL` | Yes | Speaches TTS endpoint |
| `LLM_BASE_URL` | Yes | vLLM endpoint |
| `STT_MODEL` | No | STT model name (default: faster-whisper-large-v3-turbo) |
| `TTS_MODEL` | No | TTS model name (default: Kokoro-82M) |
| `LLM_MODEL` | No | LLM model name (default: Llama 3.1 8B AWQ) |

The agent registers as a LiveKit worker and is dispatched automatically when a participant joins a room.

### 5. Deploy LiveKit Server

LiveKit is the WebRTC media server that relays audio between the browser client and the orchestrator. It runs with hostNetwork mode on a general-purpose CPU node — no ALB, domain, or TLS required.

**Create the CPU NodePool** (LiveKit + Orchestrator share this node):

```bash
kubectl apply -f k8s/nodepools.yaml
```

**Generate credentials:**

```bash
# Generate a secure API key and secret
LIVEKIT_API_KEY="devkey-$(openssl rand -hex 6)"
LIVEKIT_API_SECRET=$(openssl rand -base64 32)
echo "API Key:    $LIVEKIT_API_KEY"
echo "API Secret: $LIVEKIT_API_SECRET"
```

**Update the values file:**

Edit `helm/livekit/values.yaml` and replace the `CHANGE-ME-*` placeholders under `livekit.keys` with the generated credentials:

```yaml
keys:
  your-api-key: your-api-secret
```

**Install the chart:**

```bash
helm repo add livekit https://helm.livekit.io
helm install livekit livekit/livekit-server -f helm/livekit/values.yaml
```

### 6. Deploy Voice Pipeline (Helm)

The voice pipeline chart deploys the LLM (vLLM) and Speaches (STT+TTS) on separate GPU nodes, plus the LiveKit Agents orchestrator on a CPU node.

The orchestrator connects to LiveKit via the node's private IP. LiveKit runs with `hostNetwork: true`, and in EKS Auto Mode the ClusterIP Service does not route traffic to hostNetwork pods across nodes. You must deploy LiveKit first (step 5) and then pass its private IP to the pipeline chart:

```bash
# wait for a the node to be up and have an ip

# Get the LiveKit pod's node-internal IP
LIVEKIT_IP=$(kubectl get pods -l app.kubernetes.io/name=livekit-server \
  -o jsonpath='{.items[0].status.hostIP}')
echo "LIVEKIT_IP: $LIVEKIT_IP" # re-run the above command if no ip
```

```bash
helm install voice-pipeline helm/voice-pipeline/ \
  --set orchestrator.image.repository=$ECR_REPO \
  --set orchestrator.livekit.url="ws://${LIVEKIT_IP}:7880" \
  --set orchestrator.livekit.apiKey="$LIVEKIT_API_KEY" \
  --set orchestrator.livekit.apiSecret="$LIVEKIT_API_SECRET" \
  --set speaches.env.HF_TOKEN=$HUGGINGFACE_TOKEN
```

This provisions a Karpenter GPU NodePool and schedules each component on its own dedicated node:

| Node | Component | Instance Type | GPU |
|------|-----------|---------------|-----|
| 1 | LiveKit + Orchestrator | general-purpose (EKS Auto) | No |
| 2 | LLM (vLLM) | g5.xlarge (Karpenter) | 1x A10G |
| 3 | Speaches (STT+TTS) | g5.xlarge (Karpenter) | 1x A10G |

All nodes are pinned to a single AZ (`us-east-1a`) via Karpenter topology constraints and EKS Auto Mode subnet config, keeping inter-node latency under 0.1ms.

> **Why the private IP instead of DNS?** LiveKit uses `hostNetwork: true` to expose WebRTC ports directly. In EKS Auto Mode, the ClusterIP Service created by the LiveKit Helm chart does not correctly route traffic to hostNetwork pods on other nodes. Using the node's private IP bypasses this limitation entirely. This means LiveKit must be deployed before the voice pipeline so its IP is known.

Wait for readiness (GPU node provisioning ~3-5 min, LLM model loading ~3-5 min):

```bash
kubectl wait --for=condition=ready pod -l app.kubernetes.io/component=llm --timeout=600s
```

Verify the pipeline pod is running (LLM + Speaches share one pod; orchestrator is separate):

```bash
kubectl get pods -o wide
# voice-pipeline-llm-*          on a GPU node
# voice-pipeline-speaches-*     on a separate GPU node
# voice-pipeline-orchestrator-* on a CPU node (shared with LiveKit)
# livekit-*                     on the same CPU node as orchestrator
```

### 7. Get the public IP for the browser client

The browser connects to LiveKit from outside the cluster via its node's public IP:

```bash
NODE_NAME=$(kubectl get pods -l app.kubernetes.io/name=livekit-server \
  -o jsonpath='{.items[0].spec.nodeName}')
INSTANCE_ID=$(kubectl get node $NODE_NAME \
  -o jsonpath='{.spec.providerID}' | cut -d/ -f5)
NODE_IP=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

echo "Browser LIVEKIT_URL=ws://${NODE_IP}:7880"
```

**Run Helm tests:**

```bash
helm unittest helm/voice-pipeline/
```

### 8. Run the Browser Client

The browser client is a Next.js app that connects to the LiveKit room, captures your microphone, plays back agent responses, and displays per-stage latency metrics. It exercises the full pipeline end-to-end (mic → LiveKit → orchestrator → VAD → STT → LLM → TTS → LiveKit → speakers).

**Local development (no Docker):**

```bash
cd client

# Copy the env template and fill in values
cp .env.local.example .env.local
```

Edit `.env.local` with the LiveKit credentials from step 5 and the **public** IP from step 7:

```bash
LIVEKIT_URL=ws://<NODE_IP>:7880
LIVEKIT_API_KEY=<your-api-key>
LIVEKIT_API_SECRET=<your-api-secret>
```

Install and run:

```bash
npm install
npm run dev
# Open http://localhost:3000
```

**Docker (same image works in any environment):**

```bash
cd client
docker build -t browser-voice-client .

docker run -p 3000:3000 \
  -e LIVEKIT_URL="ws://${NODE_IP}:7880" \
  -e LIVEKIT_API_KEY="$LIVEKIT_API_KEY" \
  -e LIVEKIT_API_SECRET="$LIVEKIT_API_SECRET" \
  browser-voice-client
```

**Verify the full pipeline:**

1. Open http://localhost:3000 in Chrome or Firefox (120+)
2. Click "Connect" — status should show "Connected", then "Waiting for agent..." briefly until the orchestrator joins
3. Speak into your microphone — you should see the "You" audio visualizer respond
4. The agent responds through your speakers — the "Agent" visualizer activates
5. After each interaction, latency metrics (STT, LLM, TTS, Total) update in real-time

> **Network requirement:** Your browser must have direct UDP access to the EKS node IP on ports 50000-60000 (WebRTC media) and TCP 7880 (WebSocket signaling). If behind a corporate firewall or restrictive NAT, WebRTC will fail.

---

## Teardown

```bash
helm uninstall livekit
helm uninstall voice-pipeline
kubectl delete -f k8s/nodepools.yaml
cd terraform
terraform destroy
```

Verify no resources remain:

```bash
aws eks describe-cluster --name voiceai-eks --region us-east-1 2>&1 | grep -q "ResourceNotFoundException" && echo "✓ Cluster deleted"
aws ec2 describe-instances --filters "Name=tag:eks:cluster-name,Values=voiceai-eks" "Name=instance-state-name,Values=running" --query "Reservations[].Instances[].InstanceId" --output text
```

---

## Production Considerations

This demo uses a public subnet where nodes get public IPs for direct WebRTC media transport. For production:

- **Private subnets + [STUNner](https://github.com/l7mp/stunner)** — Kubernetes-native TURN gateway for WebRTC media relay into private nodes
- **Network Policies** — restrict pod-to-pod traffic with Calico/Cilium
- **VPC Flow Logs** — network audit and anomaly detection
- **Remote state** — S3 + DynamoDB backend for Terraform state locking
