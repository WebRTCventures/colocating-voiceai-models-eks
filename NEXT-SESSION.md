# Next Session Notes (2026-08-04)

## Status
- Infrastructure destroyed (terraform destroy completed)
- All changes committed and pushed to `main`
- Orchestrator image needs rebuild+push (session loop + latency publishing)

## Architecture Change: Shared GPU Pod
Switched from 2 GPU nodes to **1 GPU node with shared GPU**:
- vLLM + Speaches run as **sidecar containers in the same pod**
- Both containers share the single `nvidia.com/gpu: 1` device
- vLLM at `gpuMemoryUtilization: 0.65` (~15GB) leaves ~8GB for Speaches CUDA
- Speaches listens on port **8001** (vLLM keeps 8000)
- No GPU time-slicing needed — same-pod containers share `/dev/nvidia0`
- Orchestrator + LiveKit on system node (EKS Auto Mode default)

### VRAM Budget (A10G, 24GB)
- vLLM (Llama 3.1 8B AWQ INT4): ~5GB weights + ~10GB KV cache = ~15GB
- Speaches (Kokoro 82M + faster-whisper CUDA): ~3-4GB
- **Total: ~18-19GB** — comfortable headroom

### Expected Latency
- STT (faster-whisper, GPU): ~20-30ms
- LLM (8B AWQ, A10G): ~200ms
- TTS (Kokoro-82M, GPU): ~200-400ms
- **Total: ~420-630ms** ✓

### Fallback Plan
If OOM or VRAM pressure: switch to Llama 3.2 3B Instruct AWQ (~2GB VRAM)

## Deployment Order
```bash
# 1. Provision infrastructure (~15-20 min)
cd terraform && terraform apply

# 2. Connect
$(terraform output -raw update_kubeconfig_command)

# 3. Build and push orchestrator
cd ../orchestrator
ECR_REPO=$(cd ../terraform && terraform output -raw orchestrator_ecr_repository_url)
aws ecr get-login-password --region $(cd ../terraform && terraform output -raw aws_region) \
  | docker login --username AWS --password-stdin $(echo $ECR_REPO | cut -d/ -f1)
docker build -t $ECR_REPO:latest .
docker push $ECR_REPO:latest
cd ..

# 4. Deploy LiveKit
helm repo add livekit https://helm.livekit.io
helm install livekit livekit/livekit-server -f helm/livekit/values.yaml

# 5. Get LiveKit private IP (for orchestrator)
LIVEKIT_IP=$(kubectl get pods -l app.kubernetes.io/name=livekit-server -o jsonpath='{.items[0].status.hostIP}')

# 6. Deploy voice pipeline (single GPU pod with vLLM + Speaches sidecar)
ECR_REPO=$(cd terraform && terraform output -raw orchestrator_ecr_repository_url)
helm install voice-pipeline helm/voice-pipeline/ \
  --set orchestrator.image.repository=$ECR_REPO \
  --set orchestrator.livekit.url="ws://${LIVEKIT_IP}:7880" \
  --set orchestrator.livekit.apiKey="$LIVEKIT_API_KEY" \
  --set orchestrator.livekit.apiSecret="$LIVEKIT_API_SECRET" \
  --set speaches.env.HF_TOKEN=$HUGGINGFACE_TOKEN

# 7. Wait for GPU node + model loading (~8-10 min)
kubectl wait --for=condition=ready pod -l app.kubernetes.io/component=llm --timeout=600s

# 8. Get LiveKit public IP (for browser)
NODE_NAME=$(kubectl get pods -l app.kubernetes.io/name=livekit-server -o jsonpath='{.items[0].spec.nodeName}')
INSTANCE_ID=$(kubectl get node $NODE_NAME -o jsonpath='{.spec.providerID}' | cut -d/ -f5)
NODE_IP=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "LIVEKIT_URL=ws://${NODE_IP}:7880"

# 9. Run browser client
cd client
# Update .env.local with NODE_IP
npm run dev
```

## Verification Checklist
- [ ] Single GPU node provisioned (`kubectl get nodes`)
- [ ] LLM pod has 2 containers: vllm + speaches (`kubectl describe pod -l app.kubernetes.io/component=llm`)
- [ ] Both containers see GPU (`kubectl exec <pod> -c speaches -- nvidia-smi`)
- [ ] Browser connects and audio works
- [ ] Latency display populates in browser
- [ ] TTS latency < 500ms (GPU vs 2700ms CPU)
- [ ] Total pipeline < 700ms

## After Successful Test
- Take screenshots for the blog post
- Update blog post draft with final architecture
- Delete NEXT-SESSION.md
- Final commit + push
