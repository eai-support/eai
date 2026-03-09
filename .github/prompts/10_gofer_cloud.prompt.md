---
name: 10_gofer_cloud
description:
  READ-ONLY cloud infrastructure analysis for Azure, AWS, GCP deployments
agent: agent
tools: ['terminal']
argument-hint:
  Which cloud platform and what to analyze (resources, security, costs)
---

# Gofer Cloud

You are conducting comprehensive READ-ONLY analysis of cloud deployments and
infrastructure using cloud-specific CLI tools (az, aws, gcloud, etc.).

---

## SAFETY NOTICE

**This command only executes READ-ONLY cloud CLI operations.**

All commands are safe inspection operations that do not modify any cloud
resources. This is critical for agentic coding - agents must never accidentally
modify production infrastructure.

---

## When to Use This Command

- Understanding deployment architecture before feature work
- Analyzing costs and optimization opportunities
- Security and compliance audits
- Performance analysis
- Documenting existing infrastructure
- Planning infrastructure changes

---

## Step 1: Initial Setup

Ask the user:

```
I'm ready to analyze your cloud infrastructure. Please specify:
1. Which cloud platform (Azure/AWS/GCP/other)
2. What aspect to focus on (or "all" for comprehensive analysis):
   - Resources and architecture
   - Security and compliance
   - Cost optimization
   - Performance and scaling
   - Specific services or resource groups
```

Wait for user response.

---

## Step 2: Verify Cloud CLI Access

### Azure

```bash
# Check CLI installed
az version

# Verify authentication
az account show

# List subscriptions
az account list --output table
```

### AWS

```bash
# Check CLI installed
aws --version

# Verify authentication
aws sts get-caller-identity

# List profiles
aws configure list-profiles
```

### GCP

```bash
# Check CLI installed
gcloud version

# Verify authentication
gcloud auth list

# List projects
gcloud projects list
```

---

## Step 3: Analyze Resources

### Azure Resources

```bash
# List all resource groups
az group list --output table

# List all resources in subscription
az resource list --output table

# Get specific resource details
az [resource-type] show --name [name] --resource-group [rg]
```

### AWS Resources

```bash
# List EC2 instances
aws ec2 describe-instances --output table

# List S3 buckets
aws s3 ls

# List Lambda functions
aws lambda list-functions
```

### GCP Resources

```bash
# List compute instances
gcloud compute instances list

# List Cloud Run services
gcloud run services list

# List storage buckets
gsutil ls
```

---

## Step 4: Security Analysis

### Check IAM and Permissions

- Review role assignments
- Check for overly permissive policies
- Identify service accounts

### Network Security

- Review firewall rules
- Check exposed endpoints
- Analyze network topology

---

## Step 5: Cost Analysis

### Azure Costs

```bash
# View cost management
az consumption usage list --output table
```

### AWS Costs

```bash
# View cost explorer (requires permissions)
aws ce get-cost-and-usage --time-period Start=[start],End=[end] --granularity MONTHLY --metrics BlendedCost
```

---

## Step 6: Generate Report

Write to `.specify/specs/{feature}/cloud-analysis.md`:

```markdown
# Cloud Infrastructure Analysis

## Platform: [Azure/AWS/GCP]

## Analysis Date: [ISO date]

## Resources Inventory

| Resource Type | Name   | Region   | Status   |
| ------------- | ------ | -------- | -------- |
| [Type]        | [Name] | [Region] | [Status] |

## Architecture Overview

[Describe the infrastructure architecture]

## Security Findings

| Finding | Severity     | Recommendation |
| ------- | ------------ | -------------- |
| [Issue] | High/Med/Low | [Fix]          |

## Cost Summary

| Service   | Monthly Cost | Optimization |
| --------- | ------------ | ------------ |
| [Service] | $XX.XX       | [Suggestion] |

## Recommendations

1. [Recommendation 1]
2. [Recommendation 2]
```
