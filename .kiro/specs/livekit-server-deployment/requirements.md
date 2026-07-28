# Requirements Document

## Introduction

This spec covers the deployment of LiveKit Server — the WebRTC media server that serves as the shared audio transport layer between the browser client and the Pipecat orchestrator agent. LiveKit Server handles WebRTC signaling, room management, and real-time audio media relay.

The spec addresses the EKS deployment using the official LiveKit Helm chart with hostNetwork mode and direct node IP access for signaling. The browser client runs locally (localhost:3000) and connects to LiveKit via the node's public IP — no custom domain, ALB, or TLS certificate required for the demo.

LiveKit Server is a shared dependency required by Spec 3 (Pipecat Orchestrator Agent) and Spec 4 (Browser Voice Client). Both connect to LiveKit rooms using LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET credentials.

## Glossary

- **LiveKit_Server**: The open-source WebRTC media server (livekit/livekit-server) that manages rooms, handles signaling, and relays audio/video media between participants
- **Helm_Values_File**: A YAML file (`helm/livekit/values.yaml`) containing configuration overrides for the official LiveKit Helm chart deployment on EKS
- **Signaling_Port**: TCP port 7880 where LiveKit Server accepts WebSocket connections for signaling
- **Media_Ports**: UDP ports 50000-60000 used by LiveKit Server for WebRTC media (audio RTP packets)
- **Host_Network_Mode**: A Kubernetes pod networking configuration (`hostNetwork: true`) where the pod shares the node's network namespace, required for LiveKit to bind UDP media ports directly on the node
- **API_Key**: A string identifier used to authenticate clients and services connecting to LiveKit Server
- **API_Secret**: A shared secret paired with the API_Key used to sign JWT access tokens
- **Voice_Agent_Room**: The LiveKit room named "voice-agent-room" where the orchestrator agent and browser client connect to exchange audio
- **Node_Public_IP**: The public IPv4 address of the EKS GPU node, used by the browser client to connect directly to LiveKit Server for both signaling (ws://) and media (UDP)

## Requirements

### Requirement 1: EKS Deployment via Official Helm Chart

**User Story:** As a DevOps engineer, I want to deploy LiveKit Server on EKS using the official Helm chart with custom values, so that the production voice pipeline has a reliable WebRTC media server.

#### Acceptance Criteria

1. THE Helm_Values_File SHALL be located at `helm/livekit/values.yaml` and contain configuration overrides compatible with the official LiveKit Helm chart from https://github.com/livekit/livekit-helm
2. THE Helm_Values_File SHALL set `replicaCount` to 1 for the single-node demo deployment
3. THE Helm_Values_File SHALL configure `livekit.rtc.port_range_start` to 50000 and `livekit.rtc.port_range_end` to 60000 for WebRTC media UDP ports
4. THE Helm_Values_File SHALL set `livekit.rtc.use_external_ip` to true so that LiveKit advertises the node's public IP address to WebRTC clients for direct media connectivity
5. THE Helm_Values_File SHALL configure `livekit.keys` with a placeholder API key of at least 12 characters and a placeholder secret of at least 32 characters, with a comment instructing the operator to replace these with unique, randomly generated credentials before deployment
6. THE Helm_Values_File SHALL set `terminationGracePeriodSeconds` to 18000 (5 hours) to allow active WebRTC sessions to complete gracefully during pod termination
7. WHEN the operator runs `helm install` with the Helm_Values_File against the official LiveKit Helm chart, THE deployment SHALL create a single LiveKit_Server pod that reaches Ready state (all Kubernetes readiness probes passing) within 60 seconds

### Requirement 2: Host Network and Direct Node Access

**User Story:** As a DevOps engineer, I want LiveKit Server to run with host networking and accept connections directly on the node's public IP, so that the browser client can connect without requiring a domain, ALB, or TLS certificate.

#### Acceptance Criteria

1. THE Helm_Values_File SHALL configure the LiveKit pod to run with `hostNetwork: true` so that LiveKit_Server binds both the Signaling_Port (7880 TCP) and Media_Ports (50000-60000 UDP) directly on the node's network interface
2. THE Helm_Values_File SHALL set `dnsPolicy: ClusterFirstWithHostNet` so that the LiveKit pod can resolve Kubernetes service DNS names while using host networking
3. WHEN the LiveKit pod is running with Host_Network_Mode, THE browser client SHALL be able to connect to LiveKit_Server using `ws://<Node_Public_IP>:7880` for signaling without TLS (secure context is provided by the client running on localhost)
4. THE Helm_Values_File SHALL include a comment documenting that Host_Network_Mode limits the deployment to one LiveKit pod per node, and referencing STUNner as the production alternative for multi-replica deployments
5. THE Helm_Values_File SHALL disable ingress and service creation by setting `loadBalancer.type: disable` since the demo uses direct node IP access via hostNetwork rather than a load balancer or ingress controller

### Requirement 3: Security Group Configuration

**User Story:** As a DevOps engineer, I want the EKS node security group to allow inbound traffic on LiveKit's signaling and media ports, so that the browser client can reach LiveKit Server from the internet.

#### Acceptance Criteria

1. THE EKS node security group SHALL allow inbound TCP traffic on port 7880 from 0.0.0.0/0 for WebSocket signaling connections from the browser client
2. THE EKS node security group SHALL allow inbound UDP traffic on ports 50000-60000 from 0.0.0.0/0 for WebRTC media packets from the browser client
3. THE Helm_Values_File SHALL include comments documenting that these security group rules must be configured in the Terraform infrastructure (referencing the existing `terraform/` directory)
4. IF the security group does not allow inbound traffic on port 7880, THEN THE browser client connection attempt SHALL fail with a WebSocket connection timeout

### Requirement 4: API Key and Secret Management

**User Story:** As a DevOps engineer, I want clear guidance on generating and distributing LiveKit API credentials, so that the orchestrator and browser client can authenticate securely with LiveKit Server.

#### Acceptance Criteria

1. THE Helm_Values_File SHALL include a comment section documenting the command to generate a secure API key/secret pair using `openssl rand -base64 32` or the LiveKit CLI `lk create-key`, specifying that the generated secret must be at least 32 bytes (44 base64 characters) for production use
2. THE Helm_Values_File SHALL configure `livekit.keys` with a single API key/secret pair entry using placeholder values prefixed with `CHANGE-ME-` (e.g., `CHANGE-ME-api-key: CHANGE-ME-api-secret`) that indicate they must be replaced before deployment
3. WHEN the LiveKit_Server is deployed with a configured API key/secret pair, THE LiveKit_Server SHALL accept JWT tokens signed with the matching API_Secret and reject tokens signed with any other secret by refusing the WebSocket connection
4. THE Helm_Values_File SHALL include comments explaining that the same API_Key and API_Secret values must be provided to the orchestrator pod (via LIVEKIT_API_KEY and LIVEKIT_API_SECRET environment variables in the voice-pipeline ConfigMap) and to the browser client's token endpoint (via environment variables when running `npm run dev`)
5. IF the orchestrator pod is deployed with LIVEKIT_API_KEY or LIVEKIT_API_SECRET values that do not match the LiveKit_Server configuration, THEN THE orchestrator SHALL fail to join the LiveKit room and log an error message indicating authentication failure

### Requirement 5: Room Configuration

**User Story:** As a developer, I want the LiveKit room name standardized across all components, so that the orchestrator and browser client connect to the same room without manual coordination.

#### Acceptance Criteria

1. THE Helm_Values_File SHALL include a comment documenting that the default room name used by both the orchestrator agent and browser client is "voice-agent-room"
2. THE orchestrator token generation module SHALL use the room name "voice-agent-room" in the LiveKit token's room grant, and THE browser client's token endpoint SHALL use the identical room name "voice-agent-room", so that both participants are granted access to the same room
3. WHEN the first participant (either the orchestrator agent or the browser client) connects to the LiveKit_Server with a valid token granting access to "voice-agent-room", THE LiveKit_Server SHALL create the Voice_Agent_Room dynamically without requiring pre-creation
4. WHEN both the orchestrator agent and browser client hold tokens with matching room grants for "voice-agent-room" and connect to the LiveKit_Server, THE LiveKit_Server SHALL allow both participants to publish and subscribe to audio tracks within the same room

### Requirement 6: Pod Scheduling and Colocation

**User Story:** As a DevOps engineer, I want the LiveKit Server pod to run on the same node as the voice pipeline pods, so that audio traffic between the orchestrator and LiveKit has minimal latency.

#### Acceptance Criteria

1. THE Helm_Values_File SHALL configure a GPU taint toleration for `nvidia.com/gpu=true:NoSchedule` so that the LiveKit pod can schedule on the GPU node alongside the voice pipeline pods
2. THE Helm_Values_File SHALL include a `podAffinity` configuration with `preferredDuringSchedulingIgnoredDuringExecution` (weight: 100) targeting pods with the label `app.kubernetes.io/component: llm`, using `topologyKey: kubernetes.io/hostname` to prefer scheduling on the same node as the voice pipeline LLM pod
3. IF the GPU node does not have sufficient resources to schedule the LiveKit Server pod, THEN THE LiveKit_Server pod SHALL still be schedulable on another node because the affinity rule uses `preferredDuringSchedulingIgnoredDuringExecution` rather than `required`
4. THE Helm_Values_File SHALL include resource requests for CPU (500m) and memory (256Mi) that fit within the remaining capacity of a g5.2xlarge node (8 vCPUs, 32GB RAM) after the voice pipeline pods consume approximately 6 vCPUs and 10.5GB RAM
5. THE Helm_Values_File SHALL include a comment documenting the resource budget: g5.2xlarge total (8 vCPUs, 32GB) minus pipeline pods (~6.5 vCPUs with LiveKit, ~10.5GB requests), leaving headroom for kubelet and daemonsets
