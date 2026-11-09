#!/bin/bash
# Concord Program Deployment Script
# Phase 2: Full Anchor Program

set -e

echo "=========================================="
echo "Concord Program Deployment Script"
echo "=========================================="

# Check if anchor is available
if ! command -v anchor &> /dev/null; then
    echo "ERROR: anchor CLI not found. Please install Anchor."
    echo "  cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked"
    exit 1
fi

# Check Solana CLI
if ! command -v solana &> /dev/null; then
    echo "ERROR: solana CLI not found. Please install Solana CLI."
    exit 1
fi

# Set cluster
CLUSTER="devnet"
echo "Cluster: $CLUSTER"

# Configure Solana CLI
echo "Configuring Solana CLI for $CLUSTER..."
solana config set --url $CLUSTER

# Build program
echo "Building program..."
cd /home/bigben/projects/MagicBlock/MBP/programs/concord
anchor build

# Generate IDL
echo "Generating IDL..."
cargo build --features idl-build

# Check if IDL was generated
if [ ! -f "target/idl/concord.json" ]; then
    echo "WARNING: IDL not found at target/idl/concord.json"
    echo "Trying alternative location..."
    if [ -f "../../target/idl/concord.json" ]; then
        echo "Found IDL at ../../target/idl/concord.json"
        cp ../../target/idl/concord.json target/idl/ || true
    fi
fi

# Deploy program
echo "Deploying program..."
PROGRAM_ID=$(anchor deploy 2>&1 | grep "Program Id" | awk '{print $3}')
if [ -z "$PROGRAM_ID" ]; then
    echo "ERROR: Failed to extract program ID"
    exit 1
fi

echo "Program deployed successfully!"
echo "Program ID: $PROGRAM_ID"

# Update Anchor.toml with the new program ID
echo "Updating Anchor.toml..."
sed -i "s/concord = \"[^\"]*\"/concord = \"$PROGRAM_ID\"/" ../../Anchor.toml

# Verify deployment
echo "Verifying deployment..."
solana program show $PROGRAM_ID

# Run tests
echo "Running tests..."
anchor test

echo "=========================================="
echo "Deployment Complete!"
echo "Program ID: $PROGRAM_ID"
echo "=========================================="
