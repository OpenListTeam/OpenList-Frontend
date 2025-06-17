#!/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info() { echo -e "${CYAN}$1${NC}"; }
log_success() { echo -e "${GREEN}✓ $1${NC}"; }
log_error() { echo -e "${RED}✗ Error: $1${NC}"; }
log_warning() { echo -e "${YELLOW}$1${NC}"; }
log_step() { echo -e "${PURPLE}$1${NC}"; }
log_build() { echo -e "${BLUE}$1${NC}"; }

# CI Build Script
# Usage: ./build.sh [--dev|--release] [--compress|--no-compress] [--skip-i18n]
# Environment variables:
#   OPENLIST_FRONTEND_BUILD_MODE=dev|release (default: dev)
#   OPENLIST_FRONTEND_BUILD_COMPRESS=true|false (default: false)
#   OPENLIST_FRONTEND_BUILD_ENFORCE_TAG=true|false (default: false)
#   OPENLIST_FRONTEND_BUILD_SKIP_I18N=true|false (default: false)

# Set defaults from environment variables
BUILD_TYPE=${OPENLIST_FRONTEND_BUILD_MODE:-dev}
COMPRESS_FLAG=${OPENLIST_FRONTEND_BUILD_COMPRESS:-false}
ENFORCE_TAG=${OPENLIST_FRONTEND_BUILD_ENFORCE_TAG:-false}
SKIP_I18N=${OPENLIST_FRONTEND_BUILD_SKIP_I18N:-false}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dev)
            BUILD_TYPE="dev"
            shift
            ;;
        --release)
            BUILD_TYPE="release"
            shift
            ;;
        --compress)
            COMPRESS_FLAG="true"
            shift
            ;;
        --no-compress)
            COMPRESS_FLAG="false"
            shift
            ;;
        --enforce-tag)
            ENFORCE_TAG="true"
            shift
            ;;
        --skip-i18n)
            SKIP_I18N="true"
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--dev|--release] [--compress|--no-compress] [--enforce-tag] [--skip-i18n]"
            echo ""
            echo "Options (will overwrite environment setting):"
            echo "  --dev         Build development version"
            echo "  --release     Build release version (will check if git tag match package.json version)"
            echo "  --compress    Create compressed archive"
            echo "  --no-compress Skip compression"
            echo "  --enforce-tag Force git tag requirement for both dev and release builds"
            echo "  --skip-i18n   Skip i18n build step"
            echo ""
            echo "Environment variables:"
            echo "  OPENLIST_FRONTEND_BUILD_MODE=dev|release (default: dev)"
            echo "  OPENLIST_FRONTEND_BUILD_COMPRESS=true|false (default: false)"
            echo "  OPENLIST_FRONTEND_BUILD_ENFORCE_TAG=true|false (default: false)"
            echo "  OPENLIST_FRONTEND_BUILD_SKIP_I18N=true|false (default: false)"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Get git version and commit
if [ "$BUILD_TYPE" == "release" ] || [ "$ENFORCE_TAG" == "true" ]; then
    # For release build or when enforce-tag is set, git tag is required
    if ! git_version=$(git describe --abbrev=0 --tags 2>/dev/null); then
        log_error "No git tags found. Release build requires a git tag."
        log_warning "Please create a tag first, or use --dev for development builds."
        exit 1
    fi

    package_version=$(grep '"version":' package.json | sed 's/.*"version": *"\([^"]*\)".*/\1/')
    git_version_clean=${git_version#v}
    if [ "$git_version_clean" != "$package_version" ]; then
        log_error "Package.json version (${package_version}) does not match git tag (${git_version_clean})."
        exit 1
    fi
else
    # For dev build, use tag if available, otherwise fallback to v0.0.0
    git tag -d rolling >/dev/null 2>&1 || true
    git_version=$(git describe --abbrev=0 --tags 2>/dev/null || echo "v0.0.0")
    git_version_clean=${git_version#v}
    git_version_clean=${git_version_clean%%-*}
fi

commit=$(git rev-parse --short HEAD)

if [ "$BUILD_TYPE" == "dev" ]; then
    # ! For dev build, update package.json version to match git tag
    sed -i "s/\"version\": *\"[^\"]*\"/\"version\": \"${git_version_clean}\"/" package.json
    log_success "Package.json version updated to ${git_version_clean}"

    version_tag="v${git_version_clean}-${commit}"
    log_build "Building DEV version ${version_tag}..."
elif [ "$BUILD_TYPE" == "release" ]; then
    # ! For release build, we update package.json version, 
    # ! and then `git tag` to trigger CI release.
    version_tag="v${git_version_clean}"
    log_build "Building RELEASE version ${version_tag}..."
else
    log_error "Invalid build type: $BUILD_TYPE. Use --dev or --release."
    exit 1
fi

archive_name="openlist-frontend-dist-${version_tag}"
log_info "Archive name will be: ${archive_name}.tar.gz"

# build
log_step "==== Installing dependencies ===="
pnpm install

log_step "==== Building i18n ===="
if [ "$SKIP_I18N" == "false" ]; then
    pnpm i18n:release
else
    log_warning "Skipping i18n build step"
fi

log_step "==== Building project ===="
pnpm build

# Write version to dist/VERSION file
log_step "Writing version $version_tag to dist/VERSION..."
echo -n "$version_tag" | cat > dist/VERSION
log_success "Version file created: dist/VERSION"

# handle compression if requested
if [ "$COMPRESS_FLAG" == "true" ]; then
    log_step "Creating compressed archive..."

    tar -czvf "${archive_name}.tar.gz" -C dist .
    mv "${archive_name}.tar.gz" dist/
    log_success "Compressed archive created: dist/${archive_name}.tar.gz"
fi

log_success "Build completed."
