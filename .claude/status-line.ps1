# Clean single-line PowerShell statusline for Claude Code
# Professional format with essential information only

param(
    [Parameter(ValueFromPipeline=$true)]
    [string]$InputData
)

# Read all input if coming from pipeline
if (-not $InputData) {
    $InputData = $input | Out-String
}

# Helper function to get project name from path
function Get-ProjectName {
    param([string]$path)
    if (-not $path) { 
        $path = (Get-Location).Path 
    }
    
    # Extract project name from path
    $pathParts = $path -split '[\\/]'
    $projectName = $pathParts | Where-Object { $_ -match 'nestjs-ai-saas-starter' } | Select-Object -First 1
    if (-not $projectName) {
        $projectName = $pathParts[-1]  # Use last directory name
    }
    return $projectName
}

try {
    $data = $InputData | ConvertFrom-Json -ErrorAction Stop
    
    # Extract model name (simplified)
    $modelName = if ($data.model -and $data.model.display_name) { 
        $data.model.display_name -replace 'Claude ', '' -replace '20\d{6}', ''
    } else { 
        "Claude" 
    }
    
    # Context percentage
    $exceedsLimit = if ($data.exceeds_200k_tokens -ne $null) { $data.exceeds_200k_tokens } else { $false }
    $contextPercentage = if ($exceedsLimit) { 15 } else { 85 }
    
    # Cost information
    $totalCost = if ($data.cost -and $data.cost.total_cost_usd) { 
        [math]::Round($data.cost.total_cost_usd, 2) 
    } else { 
        0 
    }
    
    # Duration in seconds
    $totalDuration = if ($data.cost -and $data.cost.total_duration_ms) { 
        [math]::Round($data.cost.total_duration_ms / 1000) 
    } else { 
        0 
    }
    
    # Git branch (simplified)
    $gitBranch = ""
    try {
        $fullBranch = git branch --show-current 2>$null
        if ($fullBranch) {
            # Extract task ID from branch name if present
            if ($fullBranch -match 'TASK_[A-Z]{3}_\d{3}') {
                $gitBranch = $matches[0]
            } else {
                $gitBranch = $fullBranch
            }
        }
    } catch {
        $gitBranch = "no-git"
    }
    
    # Project name
    $projectName = Get-ProjectName $(if ($data.workspace -and $data.workspace.current_dir) { $data.workspace.current_dir } elseif ($data.cwd) { $data.cwd } else { $null })
    
    # Build single-line statusline
    $statusParts = @()
    $statusParts += $modelName
    $statusParts += "Context: ${contextPercentage}%"
    $statusParts += "Cost: `$${totalCost}"
    $statusParts += "${totalDuration}s"
    
    if ($gitBranch -and $gitBranch -ne "no-git") {
        $statusParts += "Branch: $gitBranch"
    }
    
    $statusParts += $projectName
    
    # Output clean single line
    Write-Output ($statusParts -join " | ")
    
} catch {
    # Fallback display on JSON parse error
    $projectName = Get-ProjectName $null
    Write-Output "Claude | Context: --% | Cost: `$0.00 | 0s | $projectName"
}
