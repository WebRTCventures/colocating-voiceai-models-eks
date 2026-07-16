# Colocating Voice AI Models on EKS

EKS Auto Mode cluster with GPU support for running a colocated voice AI pipeline (LiveKit + GPU-accelerated LLM inference) on a single g5.2xlarge node.

## Project Structure

```
├── terraform/              # AWS infrastructure (VPC, EKS, IAM, observability)
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── terraform.tfvars.example
├── k8s/                    # Kubernetes manifests (applied post-cluster)
│   ├── gpu-nodepool.yaml   # Karpenter NodePool for g5 GPU instances
│   └── dcgm-exporter.yaml  # NVIDIA GPU metrics DaemonSet
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
| Managed Prometheus + Grafana | ~$0.02/hr |

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
```

### 5. Verify GPU Node Provisioning

GPU nodes spin up on-demand when a pod requests `nvidia.com/gpu`. After deploying a GPU workload:

```bash
kubectl get nodes -l node.kubernetes.io/instance-type=g5.2xlarge
kubectl get nodes -l node.kubernetes.io/instance-type=g5.2xlarge -o wide  # check EXTERNAL-IP
```

Node provisioning takes up to 5 minutes after the first GPU pod is scheduled.

---

## Teardown

```bash
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
