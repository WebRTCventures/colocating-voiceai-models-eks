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
          '';
        };
      });
}
