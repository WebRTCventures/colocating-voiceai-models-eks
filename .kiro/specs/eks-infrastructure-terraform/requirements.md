# Requirements Document

## Introduction

This spec provisions an Amazon EKS Auto Mode cluster with GPU support, optimized for running a colocated voice AI pipeline on a single g5.2xlarge node (1x A10G GPU, 24GB VRAM). The infrastructure is defined entirely in Terraform and targets a single Availability Zone to guarantee pod colocation without complex multi-AZ affinity rules. The cluster uses a single public subnet architecture where nodes receive auto-assigned public IPs, enabling direct WebRTC media transport (LiveKit ICE candidates) without NAT or TURN overhead. The cluster supports GPU-accelerated LLM inference and observability via Amazon Managed Prometheus and Grafana.

**Note:** This architecture is designed for demo/blog purposes. Production deployments should consider private subnets with STUNner as a TURN gateway to avoid exposing node IPs directly.

## Glossary

- **Cluster**: The Amazon EKS Auto Mode Kubernetes cluster provisioned by this Terraform configuration
- **VPC**: The Amazon Virtual Private Cloud containing the cluster's networking resources
- **NodePool**: A Kubernetes custom resource (EKS Auto Mode NodePool CRD) that defines compute constraints for node provisioning
- **GPU_Node**: An EC2 g5.2xlarge instance (1x NVIDIA A10G, 8 vCPUs, 32GB RAM) provisioned by the NodePool
- **IRSA**: IAM Roles for Service Accounts — the mechanism for granting Kubernetes pods AWS API permissions
- **DCGM_Exporter**: The NVIDIA Data Center GPU Manager Exporter DaemonSet that exposes GPU metrics in Prometheus format
- **ALB**: Application Load Balancer provisioned by the AWS Load Balancer Controller (built into EKS Auto Mode)
- **Observability_Stack**: The combination of Amazon Managed Prometheus, Amazon Managed Grafana, and DCGM Exporter
- **WebRTC_Ports**: UDP port range 50000-60000 used by LiveKit for real-time media transport
- **Signaling_Port**: TCP port 443 used for HTTPS-based WebRTC signaling via ALB
- **Public_Subnet**: A subnet with a route to the Internet Gateway where nodes receive auto-assigned public IPv4 addresses for direct WebRTC reachability

## Requirements

### Requirement 1: VPC Networking

**User Story:** As a platform engineer, I want a VPC with a single public subnet in a single Availability Zone, so that all workloads are colocated, nodes have direct internet reachability for WebRTC, and networking is simplified for the demo.

#### Acceptance Criteria

1. THE Cluster SHALL be deployed within a VPC containing one public subnet in a single Availability Zone
2. THE VPC SHALL include an Internet Gateway with the public subnet route table directing outbound internet traffic (0.0.0.0/0) through the Internet Gateway
3. THE VPC SHALL have DNS hostnames and DNS resolution enabled
4. THE VPC SHALL use a /16 CIDR block, with the public subnet using a prefix length of /18 or shorter to accommodate at least 250 pod IP addresses
5. WHEN the public subnet is created, THE VPC SHALL tag it with `kubernetes.io/role/elb = 1` and enable auto-assign public IPv4 addresses so that nodes launched in the subnet receive public IPs for direct WebRTC reachability
6. THE Cluster node group SHALL be launched in the public subnet with auto-assigned public IPv4 addresses

### Requirement 2: EKS Auto Mode Cluster

**User Story:** As a platform engineer, I want an EKS Auto Mode cluster running Kubernetes 1.31 or later, so that node provisioning, GPU drivers, and load balancing are managed automatically.

#### Acceptance Criteria

1. THE Cluster SHALL run Kubernetes version 1.31 or later with EKS Auto Mode enabled, and SHALL be associated with a cluster IAM role that grants EKS the permissions required to manage Auto Mode components
2. WHEN EKS Auto Mode is enabled, THE Cluster SHALL automatically manage NVIDIA GPU drivers and device plugins on GPU-capable nodes without requiring manual installation of drivers or device plugin DaemonSets
3. WHEN EKS Auto Mode is enabled, THE Cluster SHALL provide load balancer management as a built-in capability such that creating a Kubernetes Service of type LoadBalancer or an Ingress resource results in automatic provisioning of an AWS load balancer without a separate controller installation
4. THE Cluster SHALL have a cluster security group that permits all intra-cluster TCP and UDP communication between nodes and pods on all ports
5. THE Cluster SHALL configure the EKS API endpoint as public-and-private to allow both local kubectl access and in-cluster communication
6. THE Cluster SHALL enable the EKS Pod Identity Agent add-on for workload authentication
7. WHEN EKS Auto Mode provisions nodes, THE Cluster SHALL launch instances from the GPU-capable instance family specified in the NodePool configuration (g5.2xlarge) within the designated public subnet

### Requirement 3: GPU NodePool

**User Story:** As a platform engineer, I want a custom NodePool that provisions g5.2xlarge GPU instances on-demand, so that voice AI workloads have dedicated GPU resources with predictable availability.

#### Acceptance Criteria

1. THE NodePool SHALL constrain instance types to g5.2xlarge as the primary type and g5.4xlarge as a fallback, where the fallback is used only when g5.2xlarge capacity is unavailable in the configured Availability Zone
2. THE NodePool SHALL use On-Demand capacity only (no Spot instances)
3. THE NodePool SHALL restrict provisioning to the single Availability Zone used by the VPC
4. WHEN a pod requesting the `nvidia.com/gpu` resource is pending, THE NodePool SHALL provision a GPU_Node within 5 minutes
5. THE NodePool SHALL apply a taint `nvidia.com/gpu=true:NoSchedule` so that only GPU-tolerant workloads schedule on GPU_Nodes
6. WHEN zero pods requesting `nvidia.com/gpu` are scheduled or pending on GPU_Nodes for 30 consecutive minutes, THE NodePool SHALL scale the GPU_Node count to zero
7. THE NodePool SHALL enforce a maximum of 2 GPU_Nodes provisioned at any time

### Requirement 4: IAM Roles for Service Accounts

**User Story:** As a platform engineer, I want IAM roles scoped to specific Kubernetes service accounts, so that pods have least-privilege access to AWS services.

#### Acceptance Criteria

1. THE Cluster SHALL provide an IAM role for the model-serving service account granting s3:GetObject and s3:ListBucket access scoped to a single configurable S3 bucket ARN used for downloading model weights
2. THE Cluster SHALL provide an IAM role for the Prometheus service account granting aps:RemoteWrite access scoped to the Amazon Managed Prometheus workspace ARN created by the observability configuration
3. THE Cluster SHALL provide an IAM role for the DCGM Exporter service account granting aps:RemoteWrite access scoped to the same Amazon Managed Prometheus workspace ARN for publishing GPU metrics
4. WHEN an IAM role is associated with a service account, THE Cluster SHALL scope the trust policy to the specific namespace and service account name using EKS Pod Identity associations, so that only pods running as that service account in that namespace can assume the role
5. IF a pod attempts to assume a role from a namespace or service account not listed in the Pod Identity association, THEN THE Cluster SHALL deny the AssumeRole request
6. THE Cluster SHALL not attach any IAM policies with wildcard (*) resource ARNs to workload IAM roles

### Requirement 5: Security Groups

**User Story:** As a platform engineer, I want security groups that allow WebRTC media, HTTPS signaling, and intra-node traffic while denying all other inbound access, so that the cluster is secure by default.

#### Acceptance Criteria

1. THE Cluster SHALL have a node security group, associated with all cluster nodes, that allows inbound UDP traffic on ports 50000-60000 from 0.0.0.0/0 and ::/0 for WebRTC media
2. THE Cluster SHALL have a node security group that allows inbound TCP traffic on port 443 from 0.0.0.0/0 and ::/0 for HTTPS signaling
3. THE Cluster SHALL have a node security group that allows all inbound traffic (all protocols, all ports) where the source is the same cluster node security group (self-referencing rule)
4. THE Cluster SHALL deny all other inbound traffic by default through the security group containing no additional allow rules beyond criteria 1-3
5. THE Cluster SHALL have a node security group that allows all outbound traffic (all protocols, all ports) to 0.0.0.0/0 and ::/0
6. WHEN the cluster is provisioned, THE Cluster SHALL have the node security group attached to every node instance in the cluster

### Requirement 6: Amazon Managed Prometheus

**User Story:** As a platform engineer, I want an Amazon Managed Prometheus workspace, so that GPU and application metrics can be stored and queried without managing Prometheus infrastructure.

#### Acceptance Criteria

1. THE Observability_Stack SHALL include an Amazon Managed Prometheus workspace with a 30-day retention period
2. WHEN the workspace is created, THE Observability_Stack SHALL output the workspace endpoint URL for remote-write configuration and the workspace ARN for IAM policy references
3. THE Observability_Stack SHALL create an IRSA-compatible IAM role scoped to a designated metrics-collection service account and namespace, that permits the `aps:RemoteWrite` action on the workspace ARN
4. IF a pod not bound to the designated metrics-collection service account attempts to assume the IRSA role, THEN THE Observability_Stack SHALL deny the assume-role request via the IAM trust policy

### Requirement 7: Amazon Managed Grafana

**User Story:** As a platform engineer, I want an Amazon Managed Grafana workspace pre-configured with the Prometheus data source, so that GPU metrics are visualizable immediately after deployment.

#### Acceptance Criteria

1. THE Observability_Stack SHALL include an Amazon Managed Grafana workspace with AWS IAM Identity Center (SSO) authentication enabled
2. WHEN the Grafana workspace is created, THE Observability_Stack SHALL configure the Amazon Managed Prometheus workspace as a data source using the Prometheus workspace endpoint, such that the data source is queryable without manual intervention
3. THE Observability_Stack SHALL output the Grafana workspace URL as a Terraform output
4. THE Observability_Stack SHALL grant the Grafana workspace IAM role the `aps:QueryMetrics`, `aps:GetMetricMetadata`, `aps:GetSeries`, and `aps:GetLabels` permissions scoped to the Prometheus workspace
5. IF the Amazon Managed Prometheus workspace is not available during deployment, THEN THE Observability_Stack SHALL fail the Terraform apply with an error message indicating the Prometheus dependency is unmet
6. THE Observability_Stack SHALL declare an explicit Terraform dependency ensuring the Prometheus workspace is fully created before the Grafana data source configuration is applied

### Requirement 8: DCGM Exporter for GPU Monitoring

**User Story:** As a platform engineer, I want the NVIDIA DCGM Exporter deployed as a DaemonSet on GPU nodes, so that GPU utilization, memory, and temperature metrics are collected and forwarded to Prometheus.

#### Acceptance Criteria

1. THE DCGM_Exporter SHALL be deployed as a Kubernetes DaemonSet that schedules only on nodes with NVIDIA GPUs, running exactly one pod per eligible GPU node
2. THE DCGM_Exporter SHALL expose metrics on port 9400 in Prometheus exposition format and provide a readiness probe endpoint that returns success only when GPU metrics are being collected
3. THE DCGM_Exporter SHALL collect GPU utilization, GPU memory usage, GPU temperature, and power draw metrics at an interval no greater than 30 seconds
4. WHEN a GPU_Node is provisioned, THE DCGM_Exporter pod SHALL reach Ready state and begin reporting metrics within 2 minutes of node readiness
5. IF the DCGM_Exporter cannot communicate with the NVIDIA GPU driver on a node, THEN THE DCGM_Exporter SHALL set its readiness probe to failing and emit a Kubernetes event indicating the failure reason

### Requirement 9: Terraform Outputs

**User Story:** As a developer following the deployment guide, I want clearly named Terraform outputs, so that I can connect to the cluster and access observability tools without manual lookups.

#### Acceptance Criteria

1. THE Cluster SHALL output the EKS cluster endpoint URL as a non-empty string after successful apply
2. THE Cluster SHALL output the `aws eks update-kubeconfig` command with the cluster name and region parameters interpolated so the command can be executed without modification
3. THE Cluster SHALL output the Amazon Managed Grafana workspace URL as a non-empty string after successful apply
4. THE Cluster SHALL output the Amazon Managed Prometheus remote-write endpoint as a non-empty string after successful apply
5. THE Cluster SHALL output the cluster name as a non-empty string after successful apply
6. THE Cluster SHALL output the AWS region as a non-empty string after successful apply
7. IF a Terraform output value depends on a resource that was not provisioned, THEN THE Cluster SHALL output an empty string for that value

### Requirement 10: Deployment Documentation

**User Story:** As a developer, I want prerequisite and deployment documentation, so that I can provision the infrastructure without prior EKS or Terraform expertise.

#### Acceptance Criteria

1. THE Cluster SHALL include a PREREQUISITES.md documenting required AWS permissions (EKS, EC2, IAM, VPC, Prometheus), the service quota for g5 instances, CLI tools with minimum versions (AWS CLI v2, Terraform >= 1.5, kubectl, Helm 3), and the requirement for a Hugging Face token with instructions on how to obtain one for Llama 3.1 model access
2. THE Cluster SHALL include a DEPLOYMENT.md with numbered step-by-step instructions from `terraform init` through `terraform apply` to verifying GPU node provisioning, where each step includes a verification command the reader can run to confirm success before proceeding to the next step
3. WHEN documenting prerequisites, THE documentation SHALL list the specific service quota name (Running On-Demand G and VT instances), state the minimum required value (8 vCPUs for g5.2xlarge), and include instructions for requesting a quota increase via the AWS Service Quotas console
4. THE documentation SHALL include a cost estimate section stating the hourly cost of the g5.2xlarge instance (~$1.21/hr), the estimated total cost for a full demo session of 1-2 hours (under $10 including distributed comparison on a second node), and a note that costs stop accruing after teardown
5. THE DEPLOYMENT.md SHALL include a teardown section with the commands to destroy all provisioned resources (`terraform destroy`) and a verification step confirming no billable resources remain running
6. THE documentation SHALL include a "Production Considerations" section noting that production deployments should use private subnets with STUNner as a Kubernetes-native TURN gateway, which provides WebRTC media relay without exposing node public IPs and integrates with EKS security groups and network policies

### Requirement 11: Provisioning Time

**User Story:** As a developer, I want the total infrastructure provisioning to complete within 20 minutes, so that the demo setup does not become a barrier to following the blog post.

#### Acceptance Criteria

1. WHEN `terraform apply` is executed with no pre-existing Terraform state file and no pre-existing target resources, THE Cluster SHALL reach a successful completion (exit code 0 with all declared resources created) within 20 minutes of wall-clock time, excluding GPU node provisioning which occurs on first pod scheduling
2. IF provisioning exceeds 20 minutes, THEN THE Cluster SHALL have parallelized independent resource creation such that no resource blocks on the completion of an unrelated resource (e.g., VPC, managed Prometheus, and managed Grafana creation run concurrently where no data dependency exists)
3. WHEN `terraform apply` completes successfully, THE Cluster SHALL have created VPC, EKS cluster, and observability resources (managed Prometheus and Grafana) as confirmed by Terraform reporting zero resources pending
