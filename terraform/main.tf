# --- Provider & Locals ---

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

locals {
  # EKS requires subnets in at least 2 AZs for control plane ENIs.
  # GPU workloads are pinned to the primary AZ via NodePool topology constraint.
  azs = slice(data.aws_availability_zones.available.names, 0, 2)

  # Common tags applied to all resources
  common_tags = {
    Project   = var.cluster_name
    ManagedBy = "terraform"
  }
}

data "aws_availability_zones" "available" {
  state = "available"

  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

# --- VPC & Networking ---

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "${var.cluster_name}-vpc"
  cidr = var.vpc_cidr

  azs            = local.azs
  public_subnets = [cidrsubnet(var.vpc_cidr, 2, 0), cidrsubnet(var.vpc_cidr, 2, 1)]

  enable_nat_gateway   = false
  enable_dns_hostnames = true
  enable_dns_support   = true

  map_public_ip_on_launch = true

  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }

  tags = local.common_tags
}

# --- EKS Auto Mode Cluster ---

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = var.cluster_name
  cluster_version = var.kubernetes_version

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.public_subnets

  # EKS Auto Mode
  cluster_compute_config = {
    enabled    = true
    node_pools = ["general-purpose", "system"]
  }

  # API endpoint access (public-and-private)
  cluster_endpoint_public_access  = true
  cluster_endpoint_private_access = true

  # Pod Identity Agent add-on
  cluster_addons = {
    eks-pod-identity-agent = {
      most_recent = true
    }
  }

  # Cluster IAM role is created by the module by default (create_iam_role = true)
  # with the required EKS permissions (AmazonEKSClusterPolicy, etc.)

  # Use our standalone node security group (WebRTC, HTTPS, intra-cluster rules)
  create_node_security_group = false
  node_security_group_id     = aws_security_group.node.id

  # Allow the Terraform caller to manage the cluster
  enable_cluster_creator_admin_permissions = true

  tags = local.common_tags
}

# --- S3 Model Bucket ---

resource "aws_s3_bucket" "models" {
  bucket = "${var.cluster_name}-models-${data.aws_caller_identity.current.account_id}"

  tags = local.common_tags
}

data "aws_caller_identity" "current" {}

# --- Security Groups ---

resource "aws_security_group" "node" {
  name        = "${var.cluster_name}-node-sg"
  description = "Security group for EKS cluster nodes - WebRTC media, HTTPS signaling, and intra-cluster traffic"
  vpc_id      = module.vpc.vpc_id

  tags = merge(local.common_tags, {
    Name = "${var.cluster_name}-node-sg"
  })
}

# Ingress: UDP 50000-60000 from 0.0.0.0/0 (WebRTC media IPv4)
resource "aws_vpc_security_group_ingress_rule" "webrtc_media_ipv4" {
  security_group_id = aws_security_group.node.id
  description       = "WebRTC media UDP (IPv4)"
  ip_protocol       = "udp"
  from_port         = 50000
  to_port           = 60000
  cidr_ipv4         = "0.0.0.0/0"

  tags = local.common_tags
}

# Ingress: UDP 50000-60000 from ::/0 (WebRTC media IPv6)
resource "aws_vpc_security_group_ingress_rule" "webrtc_media_ipv6" {
  security_group_id = aws_security_group.node.id
  description       = "WebRTC media UDP (IPv6)"
  ip_protocol       = "udp"
  from_port         = 50000
  to_port           = 60000
  cidr_ipv6         = "::/0"

  tags = local.common_tags
}

# Ingress: TCP 443 from 0.0.0.0/0 (HTTPS signaling IPv4)
resource "aws_vpc_security_group_ingress_rule" "https_signaling_ipv4" {
  security_group_id = aws_security_group.node.id
  description       = "HTTPS signaling (IPv4)"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"

  tags = local.common_tags
}

# Ingress: TCP 443 from ::/0 (HTTPS signaling IPv6)
resource "aws_vpc_security_group_ingress_rule" "https_signaling_ipv6" {
  security_group_id = aws_security_group.node.id
  description       = "HTTPS signaling (IPv6)"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv6         = "::/0"

  tags = local.common_tags
}

# Ingress: All traffic from self (intra-cluster communication)
resource "aws_vpc_security_group_ingress_rule" "intra_cluster" {
  security_group_id            = aws_security_group.node.id
  description                  = "All intra-cluster traffic (self-referencing)"
  ip_protocol                  = "-1"
  referenced_security_group_id = aws_security_group.node.id

  tags = local.common_tags
}

# Egress: All traffic to 0.0.0.0/0 (IPv4)
resource "aws_vpc_security_group_egress_rule" "all_ipv4" {
  security_group_id = aws_security_group.node.id
  description       = "All outbound traffic (IPv4)"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"

  tags = local.common_tags
}

# Egress: All traffic to ::/0 (IPv6)
resource "aws_vpc_security_group_egress_rule" "all_ipv6" {
  security_group_id = aws_security_group.node.id
  description       = "All outbound traffic (IPv6)"
  ip_protocol       = "-1"
  cidr_ipv6         = "::/0"

  tags = local.common_tags
}


# --- IAM Roles & Pod Identity ---

# Trust policy allowing EKS Pod Identity to assume roles
data "aws_iam_policy_document" "pod_identity_trust" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }

    actions = ["sts:AssumeRole", "sts:TagSession"]
  }
}

# -- Model Serving Role (S3 access for model weights) --

resource "aws_iam_role" "model_serving" {
  name               = "${var.cluster_name}-model-serving"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_trust.json

  tags = local.common_tags
}

data "aws_iam_policy_document" "model_serving" {
  statement {
    effect = "Allow"

    actions = [
      "s3:GetObject",
      "s3:ListBucket",
    ]

    resources = [
      aws_s3_bucket.models.arn,
      "${aws_s3_bucket.models.arn}/*",
    ]
  }
}

resource "aws_iam_policy" "model_serving" {
  name   = "${var.cluster_name}-model-serving"
  policy = data.aws_iam_policy_document.model_serving.json

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "model_serving" {
  role       = aws_iam_role.model_serving.name
  policy_arn = aws_iam_policy.model_serving.arn
}

resource "aws_eks_pod_identity_association" "model_serving" {
  cluster_name    = module.eks.cluster_name
  namespace       = "default"
  service_account = "model-serving"
  role_arn        = aws_iam_role.model_serving.arn

  tags = local.common_tags
}

# -- Prometheus Role (APS RemoteWrite for metrics ingestion) --

resource "aws_iam_role" "prometheus" {
  name               = "${var.cluster_name}-prometheus"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_trust.json

  tags = local.common_tags
}

data "aws_iam_policy_document" "prometheus" {
  statement {
    effect = "Allow"

    actions = ["aps:RemoteWrite"]

    resources = [aws_prometheus_workspace.main.arn]
  }
}

resource "aws_iam_policy" "prometheus" {
  name   = "${var.cluster_name}-prometheus"
  policy = data.aws_iam_policy_document.prometheus.json

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "prometheus" {
  role       = aws_iam_role.prometheus.name
  policy_arn = aws_iam_policy.prometheus.arn
}

resource "aws_eks_pod_identity_association" "prometheus" {
  cluster_name    = module.eks.cluster_name
  namespace       = "monitoring"
  service_account = "prometheus"
  role_arn        = aws_iam_role.prometheus.arn

  tags = local.common_tags
}

# -- DCGM Exporter Role (APS RemoteWrite for GPU metrics) --

resource "aws_iam_role" "dcgm_exporter" {
  name               = "${var.cluster_name}-dcgm-exporter"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_trust.json

  tags = local.common_tags
}

data "aws_iam_policy_document" "dcgm_exporter" {
  statement {
    effect = "Allow"

    actions = ["aps:RemoteWrite"]

    resources = [aws_prometheus_workspace.main.arn]
  }
}

resource "aws_iam_policy" "dcgm_exporter" {
  name   = "${var.cluster_name}-dcgm-exporter"
  policy = data.aws_iam_policy_document.dcgm_exporter.json

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "dcgm_exporter" {
  role       = aws_iam_role.dcgm_exporter.name
  policy_arn = aws_iam_policy.dcgm_exporter.arn
}

resource "aws_eks_pod_identity_association" "dcgm_exporter" {
  cluster_name    = module.eks.cluster_name
  namespace       = "monitoring"
  service_account = "dcgm-exporter"
  role_arn        = aws_iam_role.dcgm_exporter.arn

  tags = local.common_tags
}

# --- Amazon Managed Prometheus ---

resource "aws_prometheus_workspace" "main" {
  alias = "${var.cluster_name}-prometheus"

  # Note: Amazon Managed Prometheus retention is 150 days by default.
  # Configurable retention (e.g., 30 days per requirement 6.1) requires
  # aws_prometheus_workspace_configuration which needs AWS provider >= 6.28.
  # With provider ~> 5.0, retention is managed by AWS at the default 150 days.

  tags = local.common_tags
}

