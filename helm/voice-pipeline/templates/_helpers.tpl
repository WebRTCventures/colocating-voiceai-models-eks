{{/*
Standard Helm labels applied to all resources.
Usage: {{ include "voice-pipeline.labels" . }}
*/}}
{{- define "voice-pipeline.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
{{- end -}}

{{/*
Shared pipeline group label for identification and monitoring.
Usage: {{ include "voice-pipeline.pipelineLabels" . }}
*/}}
{{- define "voice-pipeline.pipelineLabels" -}}
voice-pipeline/group: {{ .Values.pipeline.group }}
{{- end -}}

{{/*
Pod affinity for CPU pods (Speaches, Orchestrator) to colocate with the LLM pod.
When scheduling.colocated is true, renders requiredDuringSchedulingIgnoredDuringExecution
targeting app.kubernetes.io/component: llm on the same node.
When scheduling.colocated is false, renders empty (no affinity constraints).
Usage: {{ include "voice-pipeline.cpuPodAffinity" . }}
*/}}
{{- define "voice-pipeline.cpuPodAffinity" -}}
{{- if .Values.scheduling.colocated }}
affinity:
  podAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchExpressions:
            - key: app.kubernetes.io/component
              operator: In
              values:
                - llm
        topologyKey: kubernetes.io/hostname
{{- end }}
{{- end -}}

{{/*
GPU taint toleration for pods that need to schedule on GPU-tainted nodes.
Accepts a boolean value — renders the toleration block when true, empty when false.
Usage: {{ include "voice-pipeline.gpuToleration" (dict "tolerateGpuTaint" .Values.speaches.tolerateGpuTaint "root" .) }}
*/}}
{{- define "voice-pipeline.gpuToleration" -}}
{{- if .tolerateGpuTaint }}
tolerations:
  - key: {{ .root.Values.gpu.taint.key }}
    operator: Equal
    value: {{ .root.Values.gpu.taint.value | quote }}
    effect: {{ .root.Values.gpu.taint.effect }}
{{- end }}
{{- end -}}
