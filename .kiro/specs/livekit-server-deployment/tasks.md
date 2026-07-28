# Implementation Plan: LiveKit Server Deployment

## Overview

Deploy LiveKit Server on EKS using the official Helm chart with a custom values file (`helm/livekit/values.yaml`) and add TCP 7880 security group rules to Terraform. The deployment uses hostNetwork mode for direct node IP access — no ALB, domain, or TLS required. Implementation involves two files: the Helm values file and a Terraform addition for the signaling port security group rule.

## Tasks

- [x] 1. Create Helm values file for LiveKit Server
  - [x] 1.1 Create `helm/livekit/values.yaml` with core LiveKit configuration
    - Create directory `helm/livekit/` and the values file
    - Set `replicaCount: 1` for single-node demo
    - Configure `livekit.port: 7880` for signaling
    - Configure `livekit.rtc.port_range_start: 50000` and `livekit.rtc.port_range_end: 60000`
    - Set `livekit.rtc.use_external_ip: true` for advertising node public IP
    - Set `livekit.turn.enabled: false` (no TURN for demo)
    - Configure `livekit.keys` with `CHANGE-ME-` prefixed placeholder credentials (key >= 12 chars, secret >= 32 chars)
    - Add comment with instructions to generate credentials via `openssl rand -base64 32` or `lk create-key`
    - Add comment documenting that same credentials must be passed to voice-pipeline and browser client
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 4.2, 4.4_

  - [x] 1.2 Add hostNetwork, DNS policy, and load balancer settings
    - Set `podHostNetwork: true` for binding ports on node interface
    - Set `loadBalancer.type: disable` to prevent Service/Ingress creation
    - Add comment documenting hostNetwork limits to one pod per node and referencing STUNner for production
    - Add comment documenting that security group rules for TCP 7880 and UDP 50000-60000 must exist in `terraform/main.tf`
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 3.3_

  - [x] 1.3 Add pod scheduling: tolerations, affinity, and resource requests
    - Configure GPU taint toleration for `nvidia.com/gpu=true:NoSchedule` (operator: Equal, value: "true", effect: NoSchedule)
    - Add `podAffinity` with `preferredDuringSchedulingIgnoredDuringExecution` (weight: 100) targeting pods with label `app.kubernetes.io/component: llm` using `topologyKey: kubernetes.io/hostname`
    - Set resource requests: CPU 500m, memory 256Mi
    - Set `terminationGracePeriodSeconds: 18000` (5 hours)
    - Add comment documenting resource budget on g5.2xlarge
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 1.6_

  - [x] 1.4 Add room name documentation comment
    - Add comment documenting default room name `voice-agent-room` used by orchestrator and browser client
    - Add comment explaining rooms are created dynamically when first participant connects
    - _Requirements: 5.1_

- [x] 2. Add TCP 7880 security group rule to Terraform
  - [x] 2.1 Add LiveKit signaling ingress rules to `terraform/main.tf`
    - Add `aws_vpc_security_group_ingress_rule.livekit_signaling_ipv4` for TCP 7880 from 0.0.0.0/0
    - Add `aws_vpc_security_group_ingress_rule.livekit_signaling_ipv6` for TCP 7880 from ::/0
    - Reference existing `aws_security_group.node.id` and `local.common_tags`
    - Place the new rules near the existing WebRTC media UDP rules for logical grouping
    - _Requirements: 3.1, 3.2_

- [x] 3. Checkpoint - Validate rendered templates and Terraform plan
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Validation tasks
  - [x] 4.1 Validate Helm template renders correctly
    - Run `helm template livekit livekit/livekit-server -f helm/livekit/values.yaml` (after adding the livekit repo)
    - Verify rendered output contains: `hostNetwork: true`, correct port config, tolerations, affinity, resource requests
    - Verify no Service or Ingress resources are rendered (loadBalancer.type: disable)
    - _Requirements: 1.7, 2.1, 2.2, 2.5, 6.1, 6.2, 6.4_

  - [x] 4.2 Validate Terraform plan includes the new security group rules
    - Run `terraform plan` and verify the new `livekit_signaling_ipv4` and `livekit_signaling_ipv6` rules appear in the plan output
    - Verify port 7880 TCP, cidr 0.0.0.0/0 and ::/0
    - _Requirements: 3.1, 3.2_

- [x] 5. Final checkpoint - Ensure all validation passes
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- No property-based tests are included — this feature is entirely static configuration (Helm YAML + Terraform HCL) with no algorithmic logic
- The official LiveKit Helm chart auto-sets `dnsPolicy: ClusterFirstWithHostNet` when `podHostNetwork: true` is configured
- The existing voice-pipeline ConfigMap already emits LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET when `orchestrator.livekit.*` values are non-empty — no template changes needed
- UDP 50000-60000 security group rules already exist in `terraform/main.tf` — only TCP 7880 needs to be added
- Room configuration (Req 5.2-5.4) is handled by the orchestrator token module and browser client, not by the LiveKit values file
- Checkpoints ensure incremental validation

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4"] },
    { "id": 2, "tasks": ["4.1", "4.2"] }
  ]
}
```
