# Requirements Document

## Introduction

This spec defines the Helm umbrella chart that deploys the complete Voice AI pipeline — LLM (GPU), Speaches STT+TTS (CPU), and Pipecat orchestrator (CPU) — as colocated pods on a single EKS node. The chart uses pod affinity rules to guarantee all pipeline components land on the same `g5.2xlarge` node, enabling sub-millisecond inter-pod communication via ClusterIP services. The chart supports two deployment modes (colocated and distributed) via values overrides, and includes a Karpenter NodePool manifest with GPU taints matching pipeline pod tolerations.

## Glossary

- **Umbrella_Chart**: The top-level Helm chart (`voice-pipeline/`) that packages all pipeline component templates, values, and helpers into a single installable unit
- **LLM_Pod**: The Kubernetes pod running the vLLM Deep Learning Container serving Llama 3.1 8B Instruct AWQ with 1 NVIDIA GPU allocated
- **Speaches_Pod**: The Kubernetes pod running the `ghcr.io/speaches-ai/speaches` container, providing both STT (Faster-Whisper large-v3-turbo int8) and TTS (Kokoro) via OpenAI-compatible API endpoints
- **Orchestrator_Pod**: The Kubernetes pod running the Pipecat voice agent that coordinates the pipeline flow (VAD → STT → LLM → TTS) with Silero VAD running in-process
- **Pipeline_Pods**: The collective term for LLM_Pod, Speaches_Pod, and Orchestrator_Pod — the three application pods comprising the voice AI pipeline
- **Colocated_Mode**: The default deployment mode where pod affinity rules constrain all Pipeline_Pods to schedule on the same Kubernetes node
- **Distributed_Mode**: An alternative deployment mode (activated via values override) where affinity constraints are removed, allowing Pipeline_Pods to schedule across different nodes
- **NodePool**: A Karpenter custom resource that defines compute constraints (instance types, taints, capacity type) for automatic node provisioning
- **GPU_Taint**: The `nvidia.com/gpu=true:NoSchedule` taint applied to GPU nodes, requiring pods to declare a matching toleration to be scheduled
- **ClusterIP_Service**: A Kubernetes Service of type ClusterIP that provides stable internal DNS-based addressing for inter-pod communication without external exposure
- **Endpoint_ConfigMap**: A Kubernetes ConfigMap containing the service URLs (LLM, Speaches STT, Speaches TTS) that the Orchestrator_Pod reads to discover pipeline services
- **Readiness_Probe**: A Kubernetes probe that signals a pod is ready to receive traffic, used to ensure models are loaded before routing requests
- **DLC_Image**: The AWS Deep Learning Container image for vLLM, available from `public.ecr.aws/deep-learning-containers/vllm:server-cuda`

## Requirements

### Requirement 1: Helm Umbrella Chart Structure

**User Story:** As a platform engineer, I want a single Helm chart that deploys all voice pipeline components in one command, so that the entire pipeline is installable and configurable as a unit.

#### Acceptance Criteria

1. THE Umbrella_Chart SHALL be structured as a valid Helm 3 chart with a `Chart.yaml`, `values.yaml`, and a `templates/` directory containing all pipeline resource templates
2. WHEN `helm install` is executed against the Umbrella_Chart with default values, THE Umbrella_Chart SHALL create exactly three application Deployments: one for LLM_Pod, one for Speaches_Pod, and one for Orchestrator_Pod
3. THE Umbrella_Chart SHALL include a `values-distributed.yaml` override file that disables pod affinity constraints for Distributed_Mode deployment
4. THE Umbrella_Chart SHALL include a `values-production.yaml` override file that targets g5.12xlarge instances and references NVIDIA NIM container images for STT and TTS
5. WHEN `helm template` is executed against the Umbrella_Chart, THE Umbrella_Chart SHALL render valid Kubernetes manifests that pass `kubectl apply --dry-run=client` without errors

### Requirement 2: LLM Deployment

**User Story:** As a platform engineer, I want the LLM pod to run vLLM with Llama 3.1 8B AWQ on a GPU, so that the pipeline has a fast, OpenAI-compatible language model endpoint.

#### Acceptance Criteria

1. THE LLM_Pod SHALL use the AWS Deep Learning Container vLLM image (`public.ecr.aws/deep-learning-containers/vllm:server-cuda`) and serve the `hugging-quants/Meta-Llama-3.1-8B-Instruct-AWQ-INT4` model
2. THE LLM_Pod SHALL request exactly 1 `nvidia.com/gpu` resource and include a toleration for the GPU_Taint (`nvidia.com/gpu=true:NoSchedule`)
3. THE LLM_Pod SHALL configure vLLM with `--gpu-memory-utilization 0.85` and `--max-model-len 4096` as container arguments
4. THE LLM_Pod SHALL expose port 8000 and respond to OpenAI-compatible `/v1/chat/completions` requests with streaming support
5. THE LLM_Pod SHALL include a Readiness_Probe that verifies the model is loaded and serving by querying the vLLM health endpoint, with an initial delay of at least 120 seconds to allow model loading
6. THE LLM_Pod SHALL set CPU requests to 2 cores and memory requests to 8Gi to accommodate model weight loading and KV cache management on the host

### Requirement 3: Speaches STT+TTS Deployment

**User Story:** As a platform engineer, I want a single Speaches pod serving both STT and TTS via OpenAI-compatible endpoints, so that speech processing requires only one container instead of two separate services.

#### Acceptance Criteria

1. THE Speaches_Pod SHALL use the `ghcr.io/speaches-ai/speaches:latest` container image and run as a CPU-only workload with no GPU resource requests
2. THE Speaches_Pod SHALL expose the `/v1/audio/transcriptions` endpoint for speech-to-text and the `/v1/audio/speech` endpoint for text-to-speech on a single port
3. THE Speaches_Pod SHALL configure the STT engine to use Faster-Whisper with the `large-v3-turbo` model at `int8` compute type via environment variables
4. THE Speaches_Pod SHALL configure the TTS engine to use Kokoro via environment variables
5. THE Speaches_Pod SHALL set CPU requests to 3 cores and memory requests to 2Gi to accommodate both the Faster-Whisper and Kokoro models in memory
6. THE Speaches_Pod SHALL include a Readiness_Probe that verifies the server is operational and models are loaded, with an initial delay of at least 60 seconds to allow model downloads
7. THE Speaches_Pod SHALL include a toleration for the GPU_Taint so that it can schedule on GPU-tainted nodes alongside the LLM_Pod

### Requirement 4: Orchestrator Deployment

**User Story:** As a platform engineer, I want the Pipecat orchestrator pod to coordinate the VAD → STT → LLM → TTS pipeline, so that voice interactions flow through all stages automatically.

#### Acceptance Criteria

1. THE Orchestrator_Pod SHALL run a placeholder container image (e.g., `registry.k8s.io/pause:3.9`) as a CPU-only workload with no GPU resource requests, to be replaced with the Pipecat agent image when Spec 3 is implemented
2. THE Orchestrator_Pod SHALL set CPU requests to 1 core and memory requests to 256Mi
3. THE Orchestrator_Pod SHALL read service endpoint URLs from environment variables sourced from the Endpoint_ConfigMap
4. THE Orchestrator_Pod SHALL include Silero VAD as an in-process component (packaged within the container image, not as a separate pod)
5. THE Orchestrator_Pod SHALL include a Readiness_Probe that verifies the agent process is running and ready to accept connections
6. THE Orchestrator_Pod SHALL include a toleration for the GPU_Taint so that it can schedule on GPU-tainted nodes alongside the LLM_Pod

### Requirement 5: Pod Affinity for Colocation

**User Story:** As a platform engineer, I want all pipeline pods to be constrained to the same Kubernetes node by default, so that inter-pod network latency is under 1ms.

#### Acceptance Criteria

1. WHEN deployed in Colocated_Mode, THE Pipeline_Pods SHALL all include a `podAffinity` rule with `requiredDuringSchedulingIgnoredDuringExecution` that uses `topologyKey: kubernetes.io/hostname` and a label selector matching a shared pipeline label
2. THE Umbrella_Chart SHALL define the pod affinity configuration as a shared template helper (`_helpers.tpl`) referenced by all three Deployment templates, ensuring consistent affinity rules across Pipeline_Pods
3. WHEN all Pipeline_Pods are scheduled in Colocated_Mode, THE Pipeline_Pods SHALL all report the same node name in `kubectl get pods -o wide` output
4. THE Pipeline_Pods SHALL all carry a common label (e.g., `voice-pipeline/group: pipeline`) that the affinity selector uses to identify colocated workloads

### Requirement 6: ClusterIP Services and Endpoint ConfigMap

**User Story:** As a platform engineer, I want ClusterIP services for each pipeline component and a ConfigMap containing their URLs, so that the orchestrator can discover and communicate with all services via stable internal DNS.

#### Acceptance Criteria

1. THE Umbrella_Chart SHALL create a ClusterIP_Service for LLM_Pod exposing port 8000, a ClusterIP_Service for Speaches_Pod exposing its serving port, and a ClusterIP_Service for Orchestrator_Pod exposing its agent port
2. THE Umbrella_Chart SHALL create an Endpoint_ConfigMap containing the full internal service URLs for: the LLM completions endpoint, the Speaches STT endpoint, and the Speaches TTS endpoint
3. WHEN a ClusterIP_Service is created, THE ClusterIP_Service SHALL use label selectors that match exactly one Deployment (LLM_Pod, Speaches_Pod, or Orchestrator_Pod respectively)
4. THE Endpoint_ConfigMap SHALL use the Kubernetes DNS format (`http://<service-name>.<namespace>.svc.cluster.local:<port>`) for all endpoint URLs

### Requirement 7: Distributed Mode Support

**User Story:** As a platform engineer, I want to switch from colocated to distributed mode via a values override, so that I can demonstrate the latency difference when pods run on separate nodes.

#### Acceptance Criteria

1. WHEN `helm install` is executed with `-f values-distributed.yaml`, THE Umbrella_Chart SHALL render Deployment manifests with no podAffinity rules, allowing the scheduler to place Pipeline_Pods on different nodes
2. THE `values-distributed.yaml` file SHALL override only the scheduling-related values and preserve all other configuration (container images, resource requests, service endpoints, probes)
3. WHEN switching from Colocated_Mode to Distributed_Mode via `helm upgrade -f values-distributed.yaml`, THE Pipeline_Pods SHALL be rescheduled according to the new scheduling policy after the rolling update completes
4. THE `values-distributed.yaml` file SHALL remove the GPU_Taint toleration from Speaches_Pod and Orchestrator_Pod so that CPU-only pods schedule on non-GPU nodes

### Requirement 8: Karpenter NodePool

**User Story:** As a platform engineer, I want a Karpenter NodePool that provisions GPU nodes with the correct taints, so that pipeline pods trigger node provisioning and only GPU-tolerant workloads schedule on those nodes.

#### Acceptance Criteria

1. THE Umbrella_Chart SHALL include a Karpenter NodePool manifest that constrains instance types to g5.2xlarge (primary) with On-Demand capacity type
2. THE NodePool SHALL apply the GPU_Taint (`nvidia.com/gpu=true:NoSchedule`) to all provisioned nodes
3. THE NodePool SHALL label provisioned nodes with `workload-type: gpu-voiceai` for identification and monitoring purposes
4. THE NodePool SHALL restrict provisioning to the same single Availability Zone configured in the EKS cluster infrastructure
5. THE NodePool SHALL set a `consolidateAfter` duration of 30 minutes with a `consolidationPolicy` of `WhenEmpty` to scale GPU nodes to zero when no pipeline pods are running
6. THE NodePool SHALL set a GPU limit of 2 `nvidia.com/gpu` to cap the maximum number of GPU nodes provisioned

### Requirement 9: Health Checks and Readiness Probes

**User Story:** As a platform engineer, I want readiness probes on each pipeline pod that verify models are loaded and serving, so that traffic is routed only to pods that are ready to process requests.

#### Acceptance Criteria

1. THE LLM_Pod SHALL have a readiness probe that queries the vLLM `/health` endpoint on port 8000 and returns success only when the model is loaded and the server accepts inference requests
2. THE Speaches_Pod SHALL have a readiness probe that queries the Speaches health endpoint and returns success only when both STT and TTS models are loaded
3. THE Orchestrator_Pod SHALL have a readiness probe that verifies the agent process is running and reachable on its configured port
4. IF a Readiness_Probe fails for any Pipeline_Pod, THEN THE corresponding ClusterIP_Service SHALL remove the pod from its endpoints until the probe passes again
5. THE LLM_Pod SHALL have a liveness probe with a longer timeout and failure threshold than the readiness probe, to restart the container only if the vLLM process becomes unrecoverable
6. WHEN LLM_Pod transitions from not-ready to ready, THE LLM_Pod readiness probe SHALL have waited at least 120 seconds (initialDelaySeconds) from container start to allow model weight loading into GPU memory

### Requirement 10: Production Mode Values

**User Story:** As a platform engineer, I want a production values file that targets a larger GPU instance with NVIDIA NIM for STT/TTS, so that the chart demonstrates the upgrade path from demo to production.

#### Acceptance Criteria

1. THE `values-production.yaml` file SHALL target g5.12xlarge instances (4x A10G GPUs) by adjusting node selectors and resource requests
2. THE `values-production.yaml` file SHALL replace the Speaches container image with NVIDIA NIM STT (Nemotron ASR) and NVIDIA NIM TTS (Magpie) images, splitting into separate STT and TTS pods
3. THE `values-production.yaml` file SHALL allocate GPU resources to the STT and TTS pods in addition to the LLM pod
4. THE `values-production.yaml` file SHALL serve as a reference configuration with inline comments explaining the production architecture differences from the default demo configuration
