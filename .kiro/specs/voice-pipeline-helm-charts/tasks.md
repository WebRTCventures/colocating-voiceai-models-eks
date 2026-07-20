# Implementation Plan: Voice Pipeline Helm Charts

## Overview

Create a Helm umbrella chart (`helm/voice-pipeline/`) that deploys the complete Voice AI pipeline — LLM (vLLM on GPU), Speaches STT+TTS (CPU), and Orchestrator placeholder (CPU) — as colocated pods on a single EKS GPU node. The chart uses asymmetric pod affinity (LLM as scheduling anchor), includes a Karpenter NodePool for GPU provisioning, and supports colocated/distributed deployment modes via values overrides.

## Tasks

- [ ] 1. Set up chart structure and template helpers
  - [ ] 1.1 Create Helm chart scaffold with Chart.yaml and values.yaml
    - Create `helm/voice-pipeline/Chart.yaml` with `apiVersion: v2`, `name: voice-pipeline`, `version: 0.1.0`
    - Create `helm/voice-pipeline/values.yaml` with the full default values schema (scheduling, gpu, llm, speaches, orchestrator, stt, tts, nodepool sections)
    - Create `helm/voice-pipeline/templates/` directory
    - _Requirements: 1.1_

  - [ ] 1.2 Create template helpers (`_helpers.tpl`)
    - Define `voice-pipeline.labels` helper for standard Helm labels (`app.kubernetes.io/name`, `app.kubernetes.io/instance`, `helm.sh/chart`)
    - Define `voice-pipeline.pipelineLabels` helper for shared `voice-pipeline/group: pipeline` label
    - Define `voice-pipeline.cpuPodAffinity` helper with conditional rendering: when `scheduling.colocated` is `true`, render `requiredDuringSchedulingIgnoredDuringExecution` with `topologyKey: kubernetes.io/hostname` targeting `app.kubernetes.io/component: llm`; when `false`, render empty
    - Define `voice-pipeline.gpuToleration` helper that conditionally renders `nvidia.com/gpu=true:NoSchedule` toleration based on the component's `tolerateGpuTaint` value
    - _Requirements: 1.1, 5.2, 5.4_

- [ ] 2. Implement LLM Deployment and Service
  - [ ] 2.1 Create LLM Deployment template
    - Create `helm/voice-pipeline/templates/llm-deployment.yaml`
    - Configure container with `public.ecr.aws/deep-learning-containers/vllm:server-cuda` image
    - Set args: `--model`, `--gpu-memory-utilization 0.85`, `--max-model-len 4096`, `--host 0.0.0.0`, `--port 8000`
    - Set resource requests (cpu: 2, memory: 8Gi, nvidia.com/gpu: 1) and limits (memory: 20Gi, nvidia.com/gpu: 1)
    - Add startup probe (HTTP GET `/health` port 8000, periodSeconds: 10, failureThreshold: 30)
    - Add readiness probe (HTTP GET `/health` port 8000, periodSeconds: 10, failureThreshold: 3)
    - Add liveness probe (HTTP GET `/health` port 8000, periodSeconds: 30, failureThreshold: 3)
    - Add GPU taint toleration (always, LLM always needs GPU node)
    - Do NOT add any podAffinity — LLM is the scheduling anchor
    - Apply standard labels with `app.kubernetes.io/component: llm` and pipeline group label
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 9.1, 9.5, 9.6_

  - [ ] 2.2 Create Services template
    - Create `helm/voice-pipeline/templates/services.yaml`
    - Define ClusterIP service `voice-pipeline-llm` targeting port 8000, selector: `app.kubernetes.io/component: llm`
    - Define ClusterIP service `voice-pipeline-speaches` targeting port 8000, selector: `app.kubernetes.io/component: speaches`
    - Define ClusterIP service `voice-pipeline-orchestrator` targeting port 8080, selector: `app.kubernetes.io/component: orchestrator`
    - _Requirements: 6.1, 6.3_

- [ ] 3. Implement Speaches Deployment
  - [ ] 3.1 Create Speaches Deployment template
    - Create `helm/voice-pipeline/templates/speaches-deployment.yaml`
    - Configure container with `ghcr.io/speaches-ai/speaches:0.7.2` image
    - Set environment variables: `WHISPER__MODEL`, `WHISPER__INFERENCE_DEVICE=cpu`, `WHISPER__COMPUTE_TYPE=int8`
    - Set resource requests (cpu: 3, memory: 2Gi) and limits (cpu: 4, memory: 4Gi), no GPU resources
    - Add readiness probe (HTTP GET `/health` port 8000, initialDelaySeconds: 60, periodSeconds: 10, failureThreshold: 3)
    - Add liveness probe (HTTP GET `/health` port 8000, initialDelaySeconds: 120, periodSeconds: 30, failureThreshold: 5)
    - Include `voice-pipeline.cpuPodAffinity` helper for pod affinity targeting LLM
    - Include conditional GPU taint toleration via `voice-pipeline.gpuToleration` helper
    - Apply standard labels with `app.kubernetes.io/component: speaches` and pipeline group label
    - Wrap deployment in `{{- if .Values.speaches.enabled }}` conditional
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.1, 9.2_

- [ ] 4. Implement Orchestrator Deployment and ConfigMap
  - [ ] 4.1 Create Orchestrator Deployment template
    - Create `helm/voice-pipeline/templates/orchestrator-deployment.yaml`
    - Configure container with `registry.k8s.io/pause:3.9` placeholder image
    - Set resource requests (cpu: 1, memory: 256Mi) and limits (cpu: 2, memory: 512Mi), no GPU resources
    - Add readiness probe (TCP socket port 8080, initialDelaySeconds: 5, periodSeconds: 10)
    - Source environment from ConfigMap `voice-pipeline-endpoints` via `envFrom`
    - Include `voice-pipeline.cpuPodAffinity` helper for pod affinity targeting LLM
    - Include conditional GPU taint toleration via `voice-pipeline.gpuToleration` helper
    - Apply standard labels with `app.kubernetes.io/component: orchestrator` and pipeline group label
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 5.1, 9.3_

  - [ ] 4.2 Create Endpoint ConfigMap template
    - Create `helm/voice-pipeline/templates/configmap.yaml`
    - Render STT_BASE_URL, TTS_BASE_URL, LLM_BASE_URL using fully-qualified DNS format (`http://<service>.<namespace>.svc.cluster.local:<port>`)
    - Conditionally route STT/TTS URLs to separate NIM services when `stt.enabled`/`tts.enabled` is true, or to Speaches service when false
    - Include LLM_MODEL, STT_MODEL, TTS_MODEL keys
    - _Requirements: 6.2, 6.4_

- [ ] 5. Implement Karpenter NodePool
  - [ ] 5.1 Create Karpenter NodePool template
    - Create `helm/voice-pipeline/templates/karpenter-nodepool.yaml`
    - Wrap in `{{- if .Values.nodepool.enabled }}` conditional
    - Render `apiVersion: karpenter.sh/v1`, `kind: NodePool`, matching the existing `k8s/gpu-nodepool.yaml` pattern
    - Configure instance types from values (default: g5.2xlarge, g5.4xlarge), capacity type on-demand
    - Apply GPU taint (`nvidia.com/gpu=true:NoSchedule`) and `workload-type: gpu-voiceai` label
    - Set AZ restriction from values (default: us-east-1a)
    - Set GPU limit from values (default: 2)
    - Set disruption policy: `consolidateAfter: 30m`, `consolidationPolicy: WhenEmpty`, `budgets: [{nodes: "0"}]`
    - Set nodeClassRef from values (default: eks.amazonaws.com/NodeClass/default)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [ ] 6. Checkpoint - Validate default chart rendering
  - Ensure `helm template helm/voice-pipeline/` renders without errors
  - Verify 3 Deployments, 3 Services, 1 ConfigMap, 1 NodePool are rendered
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Create values override files and distributed mode support
  - [ ] 7.1 Create values-distributed.yaml
    - Create `helm/voice-pipeline/values-distributed.yaml`
    - Set `scheduling.colocated: false` to disable pod affinity
    - Set `speaches.tolerateGpuTaint: false` and `orchestrator.tolerateGpuTaint: false` to remove GPU taint tolerations from CPU pods
    - Preserve all other configuration unchanged
    - _Requirements: 7.1, 7.2, 7.4_

  - [ ] 7.2 Create values-production.yaml
    - Create `helm/voice-pipeline/values-production.yaml`
    - Target g5.12xlarge with gpuLimit: 8
    - Enable `stt.enabled: true` and `tts.enabled: true` with NVIDIA NIM images
    - Disable `speaches.enabled: false`
    - Add inline comments explaining production architecture differences
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [ ] 8. Helm template rendering tests
  - [ ] 8.1 Create helm-unittest test suite for default values
    - Create `helm/voice-pipeline/tests/` directory with helm-unittest YAML test files
    - Test default rendering produces 3 Deployments, 3 Services, 1 ConfigMap, 1 NodePool
    - Test LLM deployment has GPU resource request and NO podAffinity
    - Test Speaches and Orchestrator deployments have podAffinity targeting `app.kubernetes.io/component: llm`
    - Test all pods carry `voice-pipeline/group: pipeline` label
    - Test GPU toleration is present on all pods in colocated mode
    - _Requirements: 1.2, 1.5, 5.1, 5.2, 5.4_

  - [ ] 8.2 Create helm-unittest tests for distributed mode
    - Test rendering with `values-distributed.yaml` produces no podAffinity blocks on any deployment
    - Test GPU tolerations are removed from Speaches and Orchestrator in distributed mode
    - Test all other configuration (images, resources, probes) remains unchanged
    - _Requirements: 7.1, 7.2, 7.4_

  - [ ] 8.3 Create helm-unittest tests for production mode
    - Test rendering with `values-production.yaml` disables Speaches deployment
    - Test STT and TTS pods are enabled with NIM images
    - Test ConfigMap routes STT/TTS URLs to separate NIM services
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ]* 8.4 Write property test for colocated mode affinity consistency
    - **Property 1: Colocated mode affinity consistency**
    - For any valid values with `scheduling.colocated: true`, verify Speaches and Orchestrator have identical podAffinity blocks targeting LLM component label, and LLM has no podAffinity
    - **Validates: Requirements 5.1, 5.2, 5.4**

  - [ ]* 8.5 Write property test for distributed mode removes all affinity
    - **Property 2: Distributed mode removes all affinity constraints**
    - For any valid values with `scheduling.colocated: false`, verify no rendered Deployment contains a podAffinity block
    - **Validates: Requirements 7.1, 7.2**

  - [ ]* 8.6 Write property test for GPU resource exclusivity
    - **Property 3: GPU resource exclusivity**
    - For any rendered set of Deployments, verify exactly one (LLM) requests nvidia.com/gpu and the others do not
    - **Validates: Requirements 2.2, 3.1, 4.1**

  - [ ]* 8.7 Write property test for ConfigMap URL format consistency
    - **Property 4: ConfigMap URL format consistency**
    - For any namespace value, verify all endpoint URLs follow `http://<service-name>.<namespace>.svc.cluster.local:<port>` format
    - **Validates: Requirements 6.2, 6.4**

- [ ] 9. Final checkpoint - Full chart validation
  - Run `helm template` for all three values configurations (default, distributed, production)
  - Run helm-unittest test suite
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties via helm-unittest assertions
- The chart uses Helm 3 conventions and Go template syntax throughout
- The LLM pod acts as the scheduling anchor (no affinity) while CPU pods follow it via podAffinity
- The orchestrator uses a pause container placeholder — the real Pipecat image is delivered by a separate spec

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "2.2", "4.2", "5.1"] },
    { "id": 3, "tasks": ["3.1", "4.1"] },
    { "id": 4, "tasks": ["7.1", "7.2"] },
    { "id": 5, "tasks": ["8.1", "8.2", "8.3"] },
    { "id": 6, "tasks": ["8.4", "8.5", "8.6", "8.7"] }
  ]
}
```
