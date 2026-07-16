# Deployment Guide

Step-by-step instructions to provision the EKS Auto Mode cluster with GPU support for the colocated voice AI pipeline.

## 1. Prerequisites

Complete all items in [PREREQUISITES.md](./PREREQUISITES.md) before proceeding:

- AWS CLI v2 configured with appropriate credentials
- Terraform >= 1.5 installed
- kubectl installed
- Helm 3 installed
- Service quota for "Running On-Demand G and VT instances" >= 8 vCPUs
- Hugging Face token with Llama 3.1 access

## 2. Setup

1. Navigate to the `terraform/` directory:

   ```bash
   cd terraform
   ```

2. Copy the example variables file:

   ```bash
   cp terraform.tfvars.example terraform.tfvars
   ```

3. Edit `terraform.tfvars` and set **at minimum** the `model_bucket_arn` to your S3 bucket ARN:

   ```bash
   # Replace with your actual S3 bucket ARN containing model weights
   model_bucket_arn = "arn:aws:s3:::my-model-weights-bucket"
   ```

4. Review and adjust other variables as needed (region, AZ, cluster name). Defaults work out of the box for `us-east-1a`.

## 3. Deployment Steps

### Step 1: Initialize Terraform

Download providers and modules:

```bash
terraform init
```

**Verification:**

```bash
terraform --version
# Confirm Terraform >= 1.5 and providers are installed
ls .terraform/providers/
```

Expected output: `.terraform/` directory created with provider plugins downloaded.

---

### Step 2: Validate Configuration

Check syntax and internal consistency:

```bash
terraform validate
```

**Verification:**

```
Success! The configuration is valid.
```

If validation fails, review error messages and fix `terraform.tfvars` values.

---

### Step 3: Review the Plan

Preview all resources that will be created:

```bash
terraform plan -out=tfplan
```

**Verification:**

- Confirm the plan shows resources to be created (VPC, EKS cluster, security groups, IAM roles, Prometheus, Grafana, etc.)
- Confirm `Plan: X to add, 0 to change, 0 to destroy` with no errors
- Review that no unexpected changes or deletions are listed

---

### Step 4: Apply the Configuration

Provision all infrastructure (~15-20 minutes):

```bash
terraform apply tfplan
```

Or without a saved plan (requires confirmation):

```bash
terraform apply
```

**Verification:**

```bash
# Confirm Terraform completed successfully
echo $?
# Expected: 0

# Verify the EKS cluster exists and is ACTIVE
aws eks describe-cluster \
  --name $(terraform output -raw cluster_name) \
  --region $(terraform output -raw aws_region) \
  --query "cluster.status" \
  --output text
# Expected: ACTIVE
```

---

## 4. Connecting to the Cluster

After `terraform apply` completes, configure kubectl using the Terraform output:

```bash
$(terraform output -raw update_kubeconfig_command)
```

This runs the equivalent of:

```bash
aws eks update-kubeconfig --name voiceai-eks --region us-east-1
```

**Verification:**

```bash
kubectl cluster-info
# Expected: Kubernetes control plane is running at https://<cluster-endpoint>

kubectl get ns
# Expected: lists default, kube-system, and other namespaces
```

---

## 5. Verifying GPU Node Provisioning

GPU nodes are provisioned **on-demand** when a pod requesting `nvidia.com/gpu` resources is scheduled. To verify GPU node provisioning after deploying a GPU workload:

1. Check that the NodePool is configured:

   ```bash
   kubectl get nodepools
   # Expected: gpu-voiceai NodePool listed
   ```

2. After deploying a GPU workload, verify nodes are provisioned:

   ```bash
   kubectl get nodes -l node.kubernetes.io/instance-type=g5.2xlarge
   ```

   Expected output (after a GPU pod is scheduled):

   ```
   NAME                          STATUS   ROLES    AGE   VERSION
   ip-10-0-xx-xx.ec2.internal    Ready    <none>   Xm    v1.31.x
   ```

3. Verify GPU resources are available on the node:

   ```bash
   kubectl describe nodes -l node.kubernetes.io/instance-type=g5.2xlarge | grep -A 5 "Allocatable:" | grep nvidia
   # Expected: nvidia.com/gpu: 1
   ```

4. Verify the node has a public IP (required for WebRTC):

   ```bash
   kubectl get nodes -l node.kubernetes.io/instance-type=g5.2xlarge -o wide
   # Check EXTERNAL-IP column is populated
   ```

> **Note:** GPU node provisioning takes up to 5 minutes after the first GPU pod is scheduled. No GPU nodes will appear until a pod requesting `nvidia.com/gpu` is pending.

---

## 6. Teardown

To destroy all provisioned resources and stop incurring costs:

1. Delete any Kubernetes workloads first (ensures clean ELB/ENI cleanup):

   ```bash
   kubectl delete all --all -n default
   kubectl delete all --all -n monitoring
   ```

2. Destroy all Terraform-managed resources:

   ```bash
   terraform destroy
   ```

   Review the plan and type `yes` when prompted.

3. **Verification — Confirm no billable resources remain:**

   ```bash
   # Verify EKS cluster is gone
   aws eks describe-cluster \
     --name voiceai-eks \
     --region us-east-1 2>&1 | grep -q "ResourceNotFoundException" && echo "Cluster deleted" || echo "WARNING: Cluster still exists"

   # Verify no running EC2 instances from the cluster
   aws ec2 describe-instances \
     --filters "Name=tag:eks:cluster-name,Values=voiceai-eks" "Name=instance-state-name,Values=running" \
     --query "Reservations[].Instances[].InstanceId" \
     --region us-east-1 \
     --output text
   # Expected: empty (no instances)

   # Verify VPC is deleted
   aws ec2 describe-vpcs \
     --filters "Name=tag:Name,Values=voiceai-eks-vpc" \
     --region us-east-1 \
     --query "Vpcs[].VpcId" \
     --output text
   # Expected: empty (no VPCs)
   ```

4. Remove local Terraform state (optional):

   ```bash
   rm -rf .terraform/ terraform.tfstate* tfplan
   ```

---

## 7. Production Considerations

This architecture uses a **single public subnet** where nodes receive auto-assigned public IPs for direct WebRTC media transport. This is designed for demo/blog purposes. For production deployments, consider the following:

### Private Subnets + STUNner

- Move EKS nodes to **private subnets** with a NAT Gateway for outbound-only internet access
- Deploy [STUNner](https://github.com/l7mp/stunner) as a Kubernetes-native TURN gateway to relay WebRTC media into private nodes
- STUNner integrates with EKS security groups and Kubernetes network policies, providing secure media ingress without exposing node public IPs
- This eliminates the need for nodes to have public IP addresses while preserving low-latency WebRTC transport

### Network Policies

- Apply Kubernetes NetworkPolicy resources (or Calico/Cilium policies) to restrict pod-to-pod traffic to only expected communication flows
- Isolate namespaces (e.g., `monitoring` from application workloads) with deny-all defaults and explicit allow rules

### VPC Flow Logs

- Enable VPC Flow Logs for network audit trails and anomaly detection
- Send flow logs to CloudWatch Logs or S3 for long-term retention and analysis

### Additional Recommendations

- Use a remote Terraform state backend (S3 + DynamoDB) for state locking and team collaboration
- Enable EKS cluster audit logging (API server, authenticator, controller manager)
- Consider multi-AZ for high availability (requires pod affinity/anti-affinity rules for the voice AI pipeline)
- Implement cluster autoscaler limits and cost alerts via AWS Budgets
