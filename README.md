# Colocating Voice AI Models on EKS

EKS Auto Mode cluster with GPU support for running a colocated voice AI pipeline (LiveKit + GPU-accelerated LLM inference) on a single g5.2xlarge node.

## Project Structure

```
├── terraform/              # AWS infrastructure (VPC, EKS, IAM, observability)
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── terraform.tfvars.example
├── helm/voice-pipeline/    # Helm chart for the voice AI pipeline
│   ├── Chart.yaml
│   ├── values.yaml                 # Default: colocated mode, g5.2xlarge
│   ├── values-distributed.yaml     # Override: distributed mode (no affinity)
│   ├── values-production.yaml      # Override: g5.12xlarge + NVIDIA NIM
│   ├── templates/
│   │   ├── _helpers.tpl            # Shared labels, affinity, tolerations
│   │   ├── llm-deployment.yaml     # vLLM + Llama 3.1 8B AWQ (GPU)
│   │   ├── speaches-deployment.yaml # Speaches STT+TTS (CPU)
│   │   ├── orchestrator-deployment.yaml # Pipecat placeholder (CPU)
│   │   ├── services.yaml           # 3 ClusterIP services
│   │   ├── configmap.yaml          # Endpoint URLs for service discovery
│   │   └── karpenter-nodepool.yaml # GPU node provisioning
│   └── tests/                      # helm-unittest test suites
├── k8s/                    # Kubernetes manifests (applied post-cluster)
│   ├── gpu-nodepool.yaml   # Karpenter NodePool for g5 GPU instances
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

### 4. Apply Kubernetes Manifests

```bash
kubectl apply -f ../k8s/
```

Verify:

```bash
kubectl get nodepools           # gpu-voiceai listed
kubectl get ds -n monitoring    # dcgm-exporter (0 desired until GPU node exists)
kubectl get pods -n monitoring  # grafana pod running
```

Access Grafana via port-forward:

```bash
kubectl port-forward -n monitoring svc/grafana 3000:3000
# Open http://localhost:3000 (anonymous admin access enabled)
```

### 5. Verify GPU Node Provisioning

GPU nodes spin up on-demand when a pod requests `nvidia.com/gpu`. After deploying a GPU workload:

```bash
kubectl get nodes -l node.kubernetes.io/instance-type=g5.2xlarge
kubectl get nodes -l node.kubernetes.io/instance-type=g5.2xlarge -o wide  # check EXTERNAL-IP
```

Node provisioning takes up to 5 minutes after the first GPU pod is scheduled.

### 6. Deploy Voice Pipeline (Helm)

The voice pipeline chart deploys LLM (vLLM), Speaches (STT+TTS), and an Orchestrator placeholder as colocated pods on a single GPU node.

**Default (colocated mode):**

```bash
helm install voice-pipeline helm/voice-pipeline/
```

This provisions a Karpenter NodePool, schedules the LLM pod on a GPU node, and pulls Speaches + Orchestrator onto the same node via pod affinity.

**Distributed mode** (pods on separate nodes, for latency comparison):

```bash
helm install voice-pipeline helm/voice-pipeline/ \
  -f helm/voice-pipeline/values-distributed.yaml
```

**Production mode** (g5.12xlarge + NVIDIA NIM for STT/TTS):

```bash
helm install voice-pipeline helm/voice-pipeline/ \
  -f helm/voice-pipeline/values-production.yaml
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

**Run tests:**

```bash
helm unittest helm/voice-pipeline/
```

---

## Teardown

```bash
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
