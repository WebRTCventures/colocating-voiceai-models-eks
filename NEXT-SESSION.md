# Next Session Notes (2026-07-29)

## Status
- Infrastructure fully destroyed and clean
- All changes committed and pushed to `main`
- Browser client code complete and builds successfully (`client/`)

## What Worked
- Browser client connects to LiveKit from browser ✓ (after SG fix)
- Orchestrator connects to LiveKit via node private IP ✓
- All pipeline pods colocate on GPU node via affinity ✓
- LiveKit on separate non-GPU node ✓ (acceptable — no latency impact)
- `terraform destroy` should now be clean (fixed primary SG tagging issue)

## Issues Fixed This Session
1. **Security Group wrong target**: EKS Auto Mode nodes use `cluster_primary_security_group_id`, NOT `cluster_security_group_id`. Fixed in `terraform/main.tf`.
2. **STT/TTS/LLM URLs missing `/v1`**: Pipecat's OpenAI-compatible services expect `/v1/audio/transcriptions`, etc. Fixed in `helm/voice-pipeline/templates/configmap.yaml`.
3. **VPC destroy stuck**: EKS module was tagging the primary SG, preventing EKS from auto-deleting it. Fixed with `create_cluster_primary_security_group_tags = false`. Removed the null_resource hack.
4. **LiveKit colocation unnecessary**: Removed GPU toleration and LLM pod affinity from LiveKit values. It runs on any system node — the inference pipeline latency (STT→LLM→TTS) is what matters, not the LiveKit↔orchestrator hop.

## Remaining Issue: Orchestrator → LiveKit Connectivity
The Kubernetes ClusterIP Service (`ws://livekit-livekit-server:7880`) does NOT route traffic to hostNetwork pods across nodes in EKS Auto Mode. The README currently documents this approach but it doesn't work.

**Working approach**: Use the LiveKit node's private IP directly:
```bash
PRIVATE_IP=$(kubectl get pods -l app.kubernetes.io/name=livekit-server -o jsonpath='{.items[0].status.hostIP}')
helm install voice-pipeline ... --set orchestrator.livekit.url="ws://${PRIVATE_IP}:7880"
```

**TODO**: Update README step 7 to use private IP instead of DNS name. The deployment order matters: LiveKit must be installed first so its IP is known.

## Deployment Order for Next Test
```bash
# 1. Provision infrastructure (~15-20 min)
cd terraform && terraform apply

# 2. Connect
$(terraform output -raw update_kubeconfig_command)

# 3. Deploy LiveKit
helm repo add livekit https://helm.livekit.io
helm install livekit livekit/livekit-server -f helm/livekit/values.yaml

# 4. Get LiveKit private IP (for orchestrator)
PRIVATE_IP=$(kubectl get pods -l app.kubernetes.io/name=livekit-server -o jsonpath='{.items[0].status.hostIP}')

# 5. Deploy voice pipeline with private IP
ECR_REPO=$(terraform output -raw orchestrator_ecr_repository_url)
helm install voice-pipeline helm/voice-pipeline/ \
  --set orchestrator.image.repository=$ECR_REPO \
  --set orchestrator.livekit.url="ws://${PRIVATE_IP}:7880" \
  --set orchestrator.livekit.apiKey="$LIVEKIT_API_KEY" \
  --set orchestrator.livekit.apiSecret="$LIVEKIT_API_SECRET" \
  --set speaches.env.HF_TOKEN=$HUGGINGFACE_TOKEN

# 6. Wait for GPU node + LLM model loading (~8-10 min)
kubectl wait --for=condition=ready pod -l app.kubernetes.io/component=llm --timeout=600s

# 7. Get LiveKit public IP (for browser)
NODE_NAME=$(kubectl get pods -l app.kubernetes.io/name=livekit-server -o jsonpath='{.items[0].spec.nodeName}')
INSTANCE_ID=$(kubectl get node $NODE_NAME -o jsonpath='{.spec.providerID}' | cut -d/ -f5)
NODE_IP=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

# 8. Run browser client
cd client
# Set in .env.local: LIVEKIT_URL=ws://${NODE_IP}:7880
npm run dev
```

## After Successful Test
- Update README step 7 to use private IP approach
- Remove or update the `ws://livekit-livekit-server:7880` documentation
- Take screenshots for the blog post
- Delete NEXT-SESSION.md
