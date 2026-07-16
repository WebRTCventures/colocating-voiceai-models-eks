variable "cluster_name" {
  description = "Name of the EKS cluster"
  type        = string
  default     = "voiceai-eks"

  validation {
    condition     = length(var.cluster_name) > 0 && length(var.cluster_name) <= 100
    error_message = "Cluster name must be between 1 and 100 characters."
  }
}

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"

  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]+$", var.aws_region))
    error_message = "AWS region must be a valid format (e.g., us-east-1, eu-west-2)."
  }
}

variable "availability_zone" {
  description = "Single AZ for all resources (must have g5 capacity)"
  type        = string
  default     = "us-east-1a"

  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]+[a-z]$", var.availability_zone))
    error_message = "Availability zone must be a valid format (e.g., us-east-1a, eu-west-2b)."
  }
}

variable "kubernetes_version" {
  description = "EKS Kubernetes version (must be >= 1.31)"
  type        = string
  default     = "1.31"

  validation {
    condition     = tonumber(var.kubernetes_version) >= 1.31
    error_message = "Kubernetes version must be 1.31 or later."
  }
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "VPC CIDR must be a valid IPv4 CIDR block (e.g., 10.0.0.0/16)."
  }
}

variable "grafana_admin_groups" {
  description = "IAM Identity Center group IDs for Grafana admin access"
  type        = list(string)
  default     = []
}
