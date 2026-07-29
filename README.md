# Colocating Voice AI Models on EKS

EKS Auto Mode cluster with GPU support for running a colocated voice AI pipeline (LiveKit + GPU-accelerated LLM inference) on a single g5.2xlarge node.

## Project Structure

```
├── terraform/              # AWS infrastructure (VPC, EKS, IAM, observability)
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── terraform.tfvars.example
├── helm/livekit/           # LiveKit Server values (official chart override)
│   └── values.yaml                 # hostNetwork, credentials, colocation
├── helm/voice-pipeline/    # Helm chart for the voice AI pipeline
│   ├── Chart.yaml
│   ├── values.yaml                 # Default: colocated mode, g5.2xlarge
│   ├── values-distributed.yaml     # Override: distributed mode (no affinity)
│   ├── values-production.yaml      # Override: g5.12xlarge + NVIDIA NIM
│   ├── templates/
│   │   ├── _helpers.tpl            # Shared labels, affinity, tolerations
│   │   ├── llm-deployment.yaml     # vLLM + Llama 3.1 8B AWQ (GPU)
│   │   ├── speaches-deployment.yaml # Speaches STT+TTS (CPU)
│   │   ├── orchestrator-deployment.yaml # Pipecat orchestrator (CPU)
│   │   ├── services.yaml           # 3 ClusterIP services
│   │   ├── configmap.yaml          # Endpoint URLs for service discovery
│   │   └── karpenter-nodepool.yaml # GPU node provisioning
│   └── tests/                      # helm-unittest test suites
├── orchestrator/           # Pipecat voice agent (VAD → STT → LLM → TTS)
│   ├── agent.py            # Main entry point — pipeline assembly + lifecycle
│   ├── config.py           # Environment variable loading and validation
│   ├── metrics.py          # Prometheus histograms + /health + /metrics server
│   ├── observers.py        # Pipeline observer for per-stage latency recording
│   ├── livekit_token.py    # LiveKit JWT token generation
│   ├── requirements.txt    # Python dependencies (pipecat-ai, livekit, prometheus)
│   ├── Dockerfile          # Container image (python:3.11-slim, non-root)
│   └── test_config.py      # Unit tests for config validation
├── k8s/                    # Kubernetes manifests — monitoring only
│   ├── gpu-nodepool.yaml   # (reference only — managed by Helm chart)
│   ├── dcgm-exporter.yaml  # NVIDIA GPU metrics DaemonSet
│   └── grafana.yaml        # Self-hosted Grafana for dashboards
├── flake.nix               # Nix dev environment
└── .envrc                  # direnv activation
```

## Prerequisites

### AWS Permissions

Use an IAM user or role with `AdministratorAccess` for the demo. The infrastructure touches EKS, EC2, IAM, VPC, Managed Prometheus, Managed Grafana, and IAM Identity Center.

### Service Quota

You need at least **8 vCPUs** of G-instance capacity (one g5.2xlarge = 8 vCPUs).

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

If you have Nix + direnv, just run `direnv allow` — the flake provides all tools.

### Hugging Face Token

The voice AI pipeline uses Llama 3.1. You'll need a [Hugging Face token](https://huggingface.co/settings/tokens) with access to [meta-llama/Llama-3.1-8B](https://huggingface.co/meta-llama/Llama-3.1-8B). This isn't needed for infrastructure provisioning — only when deploying the model serving workload later.

### Cost Estimate

| Resource | Cost |
|----------|------|
| g5.2xlarge | ~$1.21/hr |
| EKS cluster | $0.10/hr |
| Managed Prometheus | ~$0.01/hr |

A full demo session (1-2 hours) costs under $10. Tear down when done.

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

### 3. Connect to the Cluster

```bash
$(terraform output -raw update_kubeconfig_command)
kubectl cluster-info
```

### 4. Apply Monitoring Manifests

```bash
kubectl apply -f ../k8s/dcgm-exporter.yaml
kubectl apply -f ../k8s/grafana.yaml
```

Verify:

```bash
kubectl get ds -n monitoring    # dcgm-exporter (0 desired until GPU node exists)
kubectl get pods -n monitoring  # grafana pod running
```

Access Grafana via port-forward:

```bash
kubectl port-forward -n monitoring svc/grafana 3000:3000
# Open http://localhost:3000 (anonymous admin access enabled)
```

### 5. Build the Orchestrator Image

The orchestrator is a Pipecat voice agent that wires VAD → STT → LLM → TTS over LiveKit WebRTC. Build and push the container image to the ECR repository provisioned by Terraform:

```bash
cd orchestrator

# Get the ECR repository URL from Terraform
ECR_REPO=$(cd ../terraform && terraform output -raw orchestrator_ecr_repository_url)

# Authenticate Docker with ECR
aws ecr get-login-password --region $(cd ../terraform && terraform output -raw aws_region) \
  | docker login --username AWS --password-stdin $(echo $ECR_REPO | cut -d/ -f1)

# Build and push
docker build -t $ECR_REPO:latest .
docker push $ECR_REPO:latest

cd ..
```

The orchestrator reads all configuration from environment variables (injected via the Helm chart's ConfigMap):

| Variable | Required | Description |
|----------|----------|-------------|
| `LIVEKIT_URL` | Yes | LiveKit server WebSocket URL |
| `LIVEKIT_API_KEY` | Yes | LiveKit API key |
| `LIVEKIT_API_SECRET` | Yes | LiveKit API secret |
| `STT_BASE_URL` | Yes | Speaches STT endpoint |
| `TTS_BASE_URL` | Yes | Speaches TTS endpoint |
| `LLM_BASE_URL` | Yes | vLLM endpoint |
| `STT_MODEL` | No | STT model name (default: service default) |
| `TTS_MODEL` | No | TTS model name (default: service default) |
| `LLM_MODEL` | No | LLM model name (default: service default) |
| `VAD_SILENCE_THRESHOLD_MS` | No | Silence threshold in ms (default: 200, range: 100–2000) |
| `METRICS_PORT` | No | Prometheus metrics port (default: 8080) |

The container exposes `/health` (readiness probe) and `/metrics` (Prometheus scraping) on the metrics port.

### 6. Deploy Voice Pipeline (Helm)

The voice pipeline chart deploys LLM (vLLM), Speaches (STT+TTS), and the Pipecat Orchestrator as colocated pods on a single GPU node.

**Default (colocated mode):**

```bash
ECR_REPO=$(cd terraform && terraform output -raw orchestrator_ecr_repository_url)

helm install voice-pipeline helm/voice-pipeline/ \
  --set orchestrator.image.repository=$ECR_REPO \
  --set orchestrator.livekit.url=ws://YOUR_LIVEKIT_URL:7880 \
  --set orchestrator.livekit.apiKey=YOUR_API_KEY \
  --set orchestrator.livekit.apiSecret=YOUR_API_SECRET \
  --set speaches.env.HF_TOKEN=hf_YOUR_HUGGINGFACE_TOKEN
```

This provisions a Karpenter NodePool, schedules the LLM pod on a GPU node, and pulls Speaches + Orchestrator onto the same node via pod affinity.

> **Note:** The orchestrator requires LiveKit credentials to start. Deploy LiveKit first (step 7) or omit the `livekit.*` flags — the orchestrator pod will crash-loop until they're provided via `helm upgrade`.

**Distributed mode** (pods on separate nodes, for latency comparison):

```bash
helm install voice-pipeline helm/voice-pipeline/ \
  -f helm/voice-pipeline/values-distributed.yaml \
  --set orchestrator.image.repository=$ECR_REPO \
  --set orchestrator.livekit.url=ws://YOUR_LIVEKIT_URL:7880 \
  --set orchestrator.livekit.apiKey=YOUR_API_KEY \
  --set orchestrator.livekit.apiSecret=YOUR_API_SECRET \
  --set speaches.env.HF_TOKEN=hf_YOUR_HUGGINGFACE_TOKEN
```

**Production mode** (g5.12xlarge + NVIDIA NIM for STT/TTS):

```bash
helm install voice-pipeline helm/voice-pipeline/ \
  -f helm/voice-pipeline/values-production.yaml \
  --set orchestrator.image.repository=$ECR_REPO \
  --set orchestrator.livekit.url=ws://YOUR_LIVEKIT_URL:7880 \
  --set orchestrator.livekit.apiKey=YOUR_API_KEY \
  --set orchestrator.livekit.apiSecret=YOUR_API_SECRET \
  --set speaches.env.HF_TOKEN=hf_YOUR_HUGGINGFACE_TOKEN
```

Verify:

```bash
kubectl get pods -l voice-pipeline/group=pipeline -o wide
# All 3 pods on the same node (colocated) or spread across nodes (distributed)
kubectl get svc | grep voice-pipeline
# voice-pipeline-llm, voice-pipeline-speaches, voice-pipeline-orchestrator
```

Wait for readiness (LLM takes ~3-5 min to load the model):

```bash
kubectl wait --for=condition=ready pod -l app.kubernetes.io/component=llm --timeout=300s
```

**Run Helm tests:**

```bash
helm unittest helm/voice-pipeline/
```

**Run orchestrator unit tests:**

```bash
cd orchestrator
pip install -r requirements.txt pytest
pytest test_config.py -v
cd ..
```

### 7. Deploy LiveKit Server

LiveKit is the WebRTC media server that relays audio between the browser client and the orchestrator. It runs on the same GPU node via hostNetwork mode — no ALB, domain, or TLS required.

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

**Verify:**

```bash
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=livekit-server --timeout=60s
kubectl get pods -l app.kubernetes.io/name=livekit-server -o wide
# Should be on the same node as the voice pipeline pods
```

**Get the node public IP for browser client connection:**

```bash
NODE_IP=$(kubectl get pods -l app.kubernetes.io/name=livekit-server \
  -o jsonpath='{.items[0].status.hostIP}')
echo "LIVEKIT_URL=ws://${NODE_IP}:7880"
```

**Update the voice pipeline with LiveKit credentials:**

```bash
ECR_REPO=$(cd terraform && terraform output -raw orchestrator_ecr_repository_url)

helm upgrade voice-pipeline helm/voice-pipeline/ \
  --set orchestrator.image.repository=$ECR_REPO \
  --set orchestrator.livekit.url="ws://${NODE_IP}:7880" \
  --set orchestrator.livekit.apiKey="$LIVEKIT_API_KEY" \
  --set orchestrator.livekit.apiSecret="$LIVEKIT_API_SECRET" \
  --set speaches.env.HF_TOKEN=hf_YOUR_HUGGINGFACE_TOKEN
```

The orchestrator pod will restart and connect to the LiveKit room `voice-agent-room`.

### 8. Verify Pipeline Services

Once all pods are ready, verify each service is responding correctly using port-forwards.

**Check all pods are colocated:**

```bash
kubectl get pods -l voice-pipeline/group=pipeline -o wide
# Confirm all 3 pods show the same NODE
```

**Orchestrator health and metrics:**

```bash
kubectl port-forward svc/voice-pipeline-orchestrator 8080:8080 &
PF_PID=$!

# Health check
curl -s http://localhost:8080/health
# Expected: {"status": "ok"}

# Prometheus metrics
curl -s http://localhost:8080/metrics | grep voice_pipeline
# Expected: voice_pipeline_stage_duration_seconds and voice_pipeline_e2e_latency_seconds histograms

kill $PF_PID
```

**LLM (vLLM) — streaming chat completion:**

```bash
kubectl port-forward svc/voice-pipeline-llm 8000:8000 &
PF_PID=$!

curl -s http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "hugging-quants/Meta-Llama-3.1-8B-Instruct-AWQ-INT4",
    "messages": [{"role": "user", "content": "Say hello in one sentence."}],
    "max_tokens": 50,
    "stream": false
  }'
# Expected: JSON response with a completion in choices[0].message.content

kill $PF_PID
```

**Speaches STT — transcription test:**

```bash
kubectl port-forward svc/voice-pipeline-speaches 8001:8000 &
PF_PID=$!

# Models are pre-downloaded by the init container — no manual download needed

# Generate a short test WAV (1 second of silence — validates the endpoint accepts audio)
python3 -c "
import wave, struct
with wave.open('/tmp/test.wav', 'w') as f:
    f.setnchannels(1)
    f.setsampwidth(2)
    f.setframerate(16000)
    f.writeframes(struct.pack('<' + 'h' * 16000, *([0] * 16000)))
"

curl -s http://localhost:8001/v1/audio/transcriptions \
  -F "file=@/tmp/test.wav" \
  -F "model=deepdml/faster-whisper-large-v3-turbo-ct2"
# Expected: JSON with "text" field (may hallucinate on silence — that's normal)

kill $PF_PID
```

**Speaches TTS — speech synthesis test:**

```bash
kubectl port-forward svc/voice-pipeline-speaches 8001:8000 &
PF_PID=$!

curl -s http://localhost:8001/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model": "speaches-ai/Kokoro-82M-v1.0-ONNX", "input": "Hello world", "voice": "af_heart"}' \
  --output /tmp/test_output.wav

# Check we got audio data back (file should be > 1KB)
ls -la /tmp/test_output.wav
# Expected: file size > 1000 bytes

kill $PF_PID
```

If all checks pass, the pipeline is healthy and ready for the browser client and LiveKit integration.

---

## Teardown

```bash
helm uninstall livekit
helm uninstall voice-pipeline
kubectl delete -f ../k8s/
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
