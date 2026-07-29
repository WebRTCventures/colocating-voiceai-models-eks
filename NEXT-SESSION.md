# Next Session Notes (2026-07-29)

## Status
- Infrastructure destroyed (`terraform destroy` running — VPC deletion may still be in progress; run `terraform destroy` again if state is dirty)
- Helm releases (livekit, voice-pipeline) uninstalled before destroy
- Browser client code is complete and builds successfully

## What Worked
- Browser client connects to LiveKit ✓ (after SG fix)
- Orchestrator connects to LiveKit via private IP ✓
- All pipeline pods colocate on GPU node via affinity ✓
- LiveKit on separate non-GPU node ✓ (acceptable for demo)

## Issues Found & Fixed
1. **Security Group**: EKS Auto Mode nodes use `cluster_primary_security_group_id` (the EKS-managed SG), NOT `cluster_security_group_id` (module-created). Fixed in `terraform/main.tf`.
2. **STT/TTS/LLM URLs**: ConfigMap was missing `/v1` prefix. Fixed in `helm/voice-pipeline/templates/configmap.yaml`.
3. **ClusterIP routing doesn't work for hostNetwork pods across nodes** in EKS Auto Mode. The `ws://livekit-livekit-server:7880` DNS/Service approach times out cross-node.

## What to Fix Next
The orchestrator needs the LiveKit node's **private IP** (not ClusterIP DNS, not public IP). Two options:

### Option A: Use private IP directly (simplest)
After `helm install livekit`, get the private IP and pass it to voice-pipeline:
```bash
PRIVATE_IP=$(kubectl get pods -l app.kubernetes.io/name=livekit-server -o jsonpath='{.items[0].status.hostIP}')
helm install voice-pipeline helm/voice-pipeline/ \
  --set orchestrator.livekit.url="ws://${PRIVATE_IP}:7880" \
  ...
```
This means voice-pipeline must be deployed AFTER LiveKit is running.

### Option B: Use a headless Service (proper fix)
Create a headless Service (ClusterIP: None) for LiveKit that resolves directly to the pod/node IP via DNS. This avoids the iptables/kube-proxy issue with hostNetwork.

## Deployment Order for Next Test
1. `terraform apply` (15-20 min)
2. Connect to cluster
3. `helm install livekit` (deploys on system node immediately)
4. Get LiveKit private IP
5. `helm install voice-pipeline` with private IP (triggers GPU node, 5-8 min)
6. Wait for LLM ready
7. Get LiveKit node's PUBLIC IP for browser
8. Run `cd client && npm run dev` with public IP in `.env.local`

## README
The README at `/home/hector/AgilityFeat/colocating-voiceai-models-eks/README.md` currently documents the `ws://livekit-livekit-server:7880` DNS approach (step 7) — this needs to be updated to use the private IP approach after we confirm it works end-to-end.
