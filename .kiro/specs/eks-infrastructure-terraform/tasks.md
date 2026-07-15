# Implementation Plan: EKS Infrastructure Terraform

## Overview

This plan provisions a single-AZ, public-subnet EKS Auto Mode cluster with GPU support using Terraform. The implementation follows a consolidated 3-file structure (`main.tf`, `variables.tf`, `outputs.tf`) using the `terraform-aws-modules` ecosystem. Tasks are ordered to build foundational resources first (variables, providers, VPC), then the EKS cluster, followed by IAM/security, observability, Kubernetes manifests, and finally documentation.

## Tasks

- [ ] 1. Set up Terraform project structure and variables
  - [ ] 1.1 Create `terraform/variables.tf` with all input variables
    - Define `cluster_name` (string, default "voiceai-eks")
    - Define `aws_region` (string, default "us-east-1")
    - Define `availability_zone` (string, default "us-east-1a")
    - Define `kubernetes_version` (string, default "1.31")
    - Define `vpc_cidr` (string, default "10.0.0.0/16")
    - Define `model_bucket_arn` (string, no default — required)
    - Define `grafana_admin_groups` (list(string), default [])
    - Include descriptions and validation blocks where appropriate
    - _Requirements: 1.1, 1.4, 2.1, 3.1, 3.3, 4.1, 7.1_

  - [ ] 1.2 Create `terraform/main.tf` with provider configuration and locals
    - Configure `hashicorp/aws` provider (~> 5.0) with `var.aws_region`
    - Configure `hashicorp/kubernetes` provider (~> 2.35) using EKS cluster endpoint and token
    - Configure `hashicorp/helm` provider (~> 2.17) for future use
    - Define `terraform` block with required providers and minimum Terraform version (>= 1.5)
    - Define `locals` block with computed values (subnet CIDR, tags, etc.)
    - Add section comment headers for all resource sections
    - _Requirements: 11.2_

  - [ ] 1.3 Create `terraform/terraform.tfvars.example` with example values
    - Include all variables with example/placeholder values
    - Add comments explaining each variable
    - Mark `model_bucket_arn` as a required user-provided value
    - _Requirements: 10.2_

- [ ] 2. Implement VPC and networking
  - [ ] 2.1 Add VPC module and networking resources to `main.tf`
    - Use `terraform-aws-modules/vpc/aws` v5 module
    - Configure single public subnet in `var.availability_zone` with /18 CIDR
    - Enable `map_public_ip_on_launch = true` for public subnet
    - Enable DNS hostnames and DNS resolution
    - Attach Internet Gateway with 0.0.0.0/0 route
    - Tag subnet with `kubernetes.io/role/elb = 1`
    - No NAT Gateway, no private subnets
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [ ] 3. Implement EKS Auto Mode cluster
  - [ ] 3.1 Add EKS cluster module to `main.tf`
    - Use `terraform-aws-modules/eks/aws` v20 module
    - Configure `cluster_compute_config` with `enabled = true` for Auto Mode
    - Set Kubernetes version to `var.kubernetes_version` (>= 1.31)
    - Associate cluster with VPC and public subnet from step 2
    - Configure API endpoint as public-and-private
    - Enable Pod Identity Agent add-on
    - Create cluster IAM role with required EKS permissions
    - Add `prevent_destroy` lifecycle rule on the cluster
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 11.1_

- [ ] 4. Implement security groups
  - [ ] 4.1 Add security group resources to `main.tf`
    - Create node security group associated with the EKS cluster
    - Add ingress rule: UDP 50000-60000 from 0.0.0.0/0 and ::/0 (WebRTC media)
    - Add ingress rule: TCP 443 from 0.0.0.0/0 and ::/0 (HTTPS signaling)
    - Add self-referencing ingress rule for all intra-cluster traffic (all protocols/ports)
    - Add egress rule: all traffic to 0.0.0.0/0 and ::/0
    - No additional ingress rules beyond the three specified
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [ ] 5. Checkpoint - Validate core infrastructure
  - Ensure `terraform validate` and `terraform plan` succeed with no errors, ask the user if questions arise.

- [ ] 6. Implement IAM roles and Pod Identity associations
  - [ ] 6.1 Add IAM roles and Pod Identity to `main.tf`
    - Create model-serving IAM role with S3 GetObject/ListBucket scoped to `var.model_bucket_arn`
    - Create Prometheus IAM role with aps:RemoteWrite scoped to the Prometheus workspace ARN
    - Create DCGM Exporter IAM role with aps:RemoteWrite scoped to the Prometheus workspace ARN
    - Create Pod Identity associations for each role (specific namespace/service account)
    - Ensure no wildcard (*) resource ARNs in any workload policy
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [ ] 7. Implement observability stack
  - [ ] 7.1 Add Amazon Managed Prometheus to `main.tf`
    - Create `aws_prometheus_workspace` with alias and 30-day retention
    - Output workspace endpoint URL and ARN
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ] 7.2 Add Amazon Managed Grafana to `main.tf`
    - Create `aws_grafana_workspace` with IAM Identity Center (SSO) authentication
    - Configure Grafana IAM role with aps:QueryMetrics, aps:GetMetricMetadata, aps:GetSeries, aps:GetLabels
    - Add explicit `depends_on` on Prometheus workspace
    - Configure Prometheus as data source via `aws_grafana_workspace_configuration`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [ ] 8. Implement GPU NodePool Kubernetes manifest
  - [ ] 8.1 Add GPU NodePool CRD to `main.tf` using `kubernetes_manifest`
    - Define Karpenter `NodePool` CRD with name "gpu-voiceai"
    - Constrain instance types to g5.2xlarge and g5.4xlarge
    - Set capacity type to On-Demand only
    - Restrict topology zone to `var.availability_zone`
    - Apply taint `nvidia.com/gpu=true:NoSchedule`
    - Set `disruption.consolidateAfter: 30m` with WhenEmpty policy
    - Set GPU limit to 2 (`limits.nvidia.com/gpu: "2"`)
    - Add label `workload-type: gpu-voiceai`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [ ] 9. Implement DCGM Exporter Kubernetes manifest
  - [ ] 9.1 Add DCGM Exporter DaemonSet to `main.tf` using `kubernetes_manifest`
    - Create monitoring namespace resource
    - Create ServiceAccount for dcgm-exporter in monitoring namespace
    - Define DaemonSet with GPU node selector and toleration
    - Configure container with DCGM image (nvcr.io/nvidia/k8s/dcgm-exporter:3.3.8-3.6.0-ubuntu22.04)
    - Set metrics port 9400, collection interval 30s
    - Add readiness probe on /health endpoint
    - Configure resource requests/limits (100m/128Mi - 200m/256Mi)
    - Set privileged security context and mount device-plugins volume
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ] 10. Implement Terraform outputs
  - [ ] 10.1 Create `terraform/outputs.tf` with all required outputs
    - Output `cluster_endpoint` (EKS API endpoint URL)
    - Output `update_kubeconfig_command` (interpolated `aws eks update-kubeconfig` command)
    - Output `grafana_workspace_url` (Grafana endpoint URL)
    - Output `prometheus_remote_write_endpoint` (AMP remote-write URL)
    - Output `cluster_name` (cluster name string)
    - Output `aws_region` (region string)
    - Ensure all outputs are non-empty strings after successful apply
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

- [ ] 11. Checkpoint - Full Terraform validation
  - Ensure `terraform validate` passes, `terraform plan` shows expected resource count with no errors, ask the user if questions arise.

- [ ] 12. Create deployment documentation
  - [ ] 12.1 Create `terraform/PREREQUISITES.md`
    - Document required AWS permissions (EKS, EC2, IAM, VPC, Prometheus, Grafana)
    - Document service quota: "Running On-Demand G and VT instances" minimum 8 vCPUs
    - Include quota increase request instructions via AWS Service Quotas console
    - List CLI tool requirements with minimum versions (AWS CLI v2, Terraform >= 1.5, kubectl, Helm 3)
    - Document Hugging Face token requirement with instructions for Llama 3.1 access
    - Include cost estimate: g5.2xlarge at ~$1.21/hr, full demo under $10
    - _Requirements: 10.1, 10.3, 10.4_

  - [ ] 12.2 Create `terraform/DEPLOYMENT.md`
    - Write numbered step-by-step instructions from `terraform init` through `terraform apply`
    - Include verification command after each step (e.g., `terraform validate`, `aws eks describe-cluster`)
    - Document how to verify GPU node provisioning (`kubectl get nodes -l node.kubernetes.io/instance-type`)
    - Include `update-kubeconfig` instructions referencing Terraform output
    - Add teardown section with `terraform destroy` and verification of resource cleanup
    - Add "Production Considerations" section noting private subnets + STUNner for production
    - _Requirements: 10.2, 10.5, 10.6_

- [ ] 13. Final checkpoint - Complete validation
  - Ensure `terraform validate` passes, all files are consistent, documentation is complete, ask the user if questions arise.

## Notes

- This is an Infrastructure as Code project — no property-based tests apply
- Terraform validation (`terraform validate`, `terraform plan`) serves as the primary correctness check
- The consolidated 3-file structure (`main.tf`, `variables.tf`, `outputs.tf`) is intentional for blog readability
- GPU node provisioning happens lazily on first GPU pod scheduling, not at `terraform apply` time
- The `prevent_destroy` lifecycle rule on the EKS cluster prevents accidental deletion
- Security groups explicitly deny all inbound traffic not matching the three specified rules (WebRTC, HTTPS, self-referencing)
- All IAM policies use least-privilege with no wildcard resource ARNs

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["3.1", "7.1"] },
    { "id": 4, "tasks": ["4.1", "6.1", "7.2"] },
    { "id": 5, "tasks": ["8.1", "9.1", "10.1"] },
    { "id": 6, "tasks": ["12.1", "12.2"] }
  ]
}
```
