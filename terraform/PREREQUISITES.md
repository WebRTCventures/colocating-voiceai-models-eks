# Prerequisites

Before deploying the EKS infrastructure, ensure you have the following permissions, quotas, tools, and access configured.

---

## 1. Required AWS Permissions

Your AWS IAM user or role must have permissions for the following services:

| Service | Actions Required |
|---------|-----------------|
| **Amazon EKS** | Full access to create/manage clusters, node groups, add-ons, and Pod Identity associations |
| **Amazon EC2** | Launch instances (g5.2xlarge), manage security groups, VPCs, subnets, internet gateways, and elastic IPs |
| **AWS IAM** | Create/manage roles, policies, instance profiles, and OIDC providers |
| **Amazon VPC** | Create/manage VPCs, subnets, route tables, internet gateways, and security groups |
| **Amazon Managed Prometheus** | Create/manage workspaces and configure remote-write |
| **Amazon Managed Grafana** | Create/manage workspaces, configure data sources, and manage SSO authentication |
| **AWS SSO (IAM Identity Center)** | Required for Grafana workspace authentication setup |

**Recommended approach:** Use an IAM user or role with the `AdministratorAccess` managed policy for the demo. For production, scope permissions down to the specific actions listed above.

---

## 2. Service Quotas

### Running On-Demand G and VT Instances

This deployment requires at least **8 vCPUs** of G-instance capacity (one g5.2xlarge has 8 vCPUs).

| Quota Name | Service | Minimum Value |
|------------|---------|---------------|
| Running On-Demand G and VT instances | Amazon EC2 | 8 vCPUs |

**Check your current quota:**

```bash
aws service-quotas get-service-quota \
  --service-code ec2 \
  --quota-code L-DB2E81BA \
  --region us-east-1 \
  --query 'Quota.Value'
```

If the value returned is less than 8, you need to request an increase.

### How to Request a Quota Increase

1. Open the [AWS Service Quotas console](https://console.aws.amazon.com/servicequotas/)
2. Select **Amazon Elastic Compute Cloud (Amazon EC2)** from the service list
3. Search for **"Running On-Demand G and VT instances"**
4. Click the quota name, then click **Request increase at account-level**
5. Enter `8` (or higher if you plan to test with two GPU nodes) as the new value
6. Submit the request

> **Note:** Quota increase requests are typically approved within minutes for small values, but may take up to a few hours. Request the increase before starting the deployment.

---

## 3. CLI Tools

Install the following tools with the specified minimum versions:

| Tool | Minimum Version | Purpose |
|------|-----------------|---------|
| **AWS CLI** | v2.x | AWS resource management and EKS authentication |
| **Terraform** | >= 1.5 | Infrastructure provisioning |
| **kubectl** | v1.31+ | Kubernetes cluster interaction |
| **Helm** | v3.x | Kubernetes package management (future deployments) |

### Installation Instructions

**AWS CLI v2:**

```bash
# macOS
brew install awscli

# Linux
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Verify
aws --version
```

**Terraform (>= 1.5):**

```bash
# macOS
brew tap hashicorp/tap
brew install hashicorp/tap/terraform

# Linux (Ubuntu/Debian)
wget -O - https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt update && sudo apt install terraform

# Verify
terraform version
```

**kubectl:**

```bash
# macOS
brew install kubectl

# Linux
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl
sudo mv kubectl /usr/local/bin/

# Verify
kubectl version --client
```

**Helm 3:**

```bash
# macOS
brew install helm

# Linux
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Verify
helm version
```

### Configure AWS CLI

```bash
aws configure
# Enter your AWS Access Key ID, Secret Access Key, and default region (us-east-1)
```

---

## 4. Hugging Face Token

The voice AI pipeline uses Meta's Llama 3.1 model, which requires a Hugging Face access token with approval for the model.

### Steps to Get Access

1. **Create a Hugging Face account** at [huggingface.co](https://huggingface.co/join)

2. **Request access to Llama 3.1:**
   - Navigate to the [Meta Llama 3.1 model page](https://huggingface.co/meta-llama/Llama-3.1-8B)
   - Click **"Request access"** and fill out the form
   - Wait for approval (usually within a few hours)

3. **Generate an access token:**
   - Go to [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
   - Click **"New token"**
   - Name it (e.g., `voiceai-eks-demo`) and select **"Read"** permission
   - Copy the token — you'll need it when deploying the model serving workloads

> **Important:** Keep your token secure. You will provide it as a Kubernetes Secret when deploying the LLM inference workload (not during Terraform provisioning).

---

## 5. Cost Estimate

This demo uses GPU instances that incur costs while running.

| Resource | Hourly Cost | Notes |
|----------|-------------|-------|
| g5.2xlarge (1x A10G GPU, 8 vCPUs, 32GB RAM) | ~$1.21/hr | On-demand pricing in us-east-1 |
| EKS cluster | $0.10/hr | Flat cluster fee |
| Amazon Managed Prometheus | ~$0.01/hr | Based on ingestion volume |
| Amazon Managed Grafana | ~$0.01/hr | Based on active users |

### Expected Demo Session Cost

| Scenario | Duration | Estimated Cost |
|----------|----------|----------------|
| Single node demo | 1-2 hours | **~$3-5** |
| Full demo with distributed comparison (2 GPU nodes) | 1-2 hours | **Under $10** |

### Important: Tear Down After Use

GPU instances accrue costs even when idle. After completing the demo:

```bash
terraform destroy
```

**Costs stop accruing immediately after teardown.** The EKS Auto Mode NodePool scales GPU nodes to zero after 30 minutes of inactivity, but the EKS cluster fee ($0.10/hr) and observability resources continue running until explicitly destroyed.

> **Tip:** Run `terraform destroy` as soon as you finish the demo to avoid unexpected charges.
