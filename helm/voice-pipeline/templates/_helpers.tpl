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
