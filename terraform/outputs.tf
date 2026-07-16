output "cluster_endpoint" {
  description = "EKS cluster API endpoint URL"
  value       = module.eks.cluster_endpoint
}

output "update_kubeconfig_command" {
  description = "Command to configure kubectl for the EKS cluster"
  value       = "aws eks update-kubeconfig --name ${module.eks.cluster_name} --region ${var.aws_region}"
}

output "prometheus_remote_write_endpoint" {
  description = "Amazon Managed Prometheus remote-write endpoint URL"
  value       = "${aws_prometheus_workspace.main.prometheus_endpoint}api/v1/remote_write"
}

output "cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_name
}

output "aws_region" {
  description = "AWS region where resources are deployed"
  value       = var.aws_region
}

output "model_bucket_name" {
  description = "S3 bucket for model weights"
  value       = aws_s3_bucket.models.id
}
