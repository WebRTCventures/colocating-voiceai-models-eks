{
  description = "EKS Infrastructure Terraform dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Infrastructure
            terraform        # Terraform >= 1.5
            awscli2          # AWS CLI v2

            # Kubernetes
            kubectl          # kubectl
            kubernetes-helm  # Helm 3
            kubernetes-helmPlugins.helm-unittest  # Helm chart testing

            # Python (orchestrator development)
            python311        # Python 3.11 (matches Dockerfile)
            python311Packages.pip
            python311Packages.virtualenv

            # Container tooling
            docker-client    # Docker CLI for building images

            # Utilities
            jq
            yq-go
          ];

          shellHook = ''
            echo "🚀 EKS Voice AI Infrastructure environment loaded"
            echo "   terraform $(terraform version -json | jq -r .terraform_version)"
            echo "   aws       $(aws --version 2>&1 | cut -d/ -f2 | cut -d' ' -f1)"
            echo "   kubectl   $(kubectl version --client -o json 2>/dev/null | jq -r .clientVersion.gitVersion)"
            echo "   helm      $(helm version --short)"
            echo "   python    $(python3 --version)"

            # Auto-create orchestrator virtualenv if it doesn't exist
            if [ ! -d "orchestrator/.venv" ] && [ -f "orchestrator/requirements.txt" ]; then
              echo "   Creating orchestrator virtualenv..."
              python3 -m venv orchestrator/.venv
              orchestrator/.venv/bin/pip install --quiet -r orchestrator/requirements.txt
              echo "   ✓ orchestrator venv ready"
            fi

            # Activate orchestrator venv if it exists
            if [ -d "orchestrator/.venv" ]; then
              source orchestrator/.venv/bin/activate
            fi
          '';
        };
      });
}
