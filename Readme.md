# Setup instructions

## Install dependencies

```powershell
choco install azure-cli
choco install pulumi
```

## Create a resource group in the Azure UI

Call it DcsMultiplayerServer. We do this outside of the Pulumi script so we never delete it by accident (it has the hard drive images attached to it).

## Create a storage account in the Azure UI

Now we have dcsmultiplayerscriptseg as a placeholder in index.ts, replace with yours.

Upload the script

```powershell
param (
    [string]$ResourceGroupName,
    [string]$VmName
)
Stop-AzVM -ResourceGroupName $ResourceGroupName -Name $VmName -Force
Remove-AzVM -ResourceGroupName $ResourceGroupName -Name $VmName -Force
```

to it as deleteVm.ps1

## Login to Azure and configure

```powershell
az login --use-device-code
pulumi login
pulumi config set azure-native:subscriptionId <your-subscription-id>
pulumi config set azure-native:location <your-location>
pulumi config set --secret adminPassword "YourPasswordHere123!"
pulumi up
```

## Set up DCS drive for the first time

```powershell
$disk = Get-Disk | Where-Object PartitionStyle -eq 'RAW'

try {
    # Initialize the disk
    $disk | Initialize-Disk -PartitionStyle GPT -PassThru

    # Create a new partition using the maximum size available
    $partition = $disk | New-Partition -UseMaximumSize -AssignDriveLetter

    # Format the partition
    $partition | Format-Volume -FileSystem NTFS -NewFileSystemLabel "DataDisk" -Confirm:$false -Force

    # Output the results
    Write-Host "Disk initialization completed successfully"
    Write-Host "Drive letter assigned: $($partition.DriveLetter)"
    Write-Host "Volume label: DataDisk"
    Write-Host "Size: $([math]::Round($partition.Size/1GB,2)) GB"
} catch {
    Write-Host "An error occurred during disk initialization:"
    Write-Host $_.Exception.Message
    exit 1
}

# Verify the disk is online and healthy
Get-Disk | Where-Object Number -eq $disk.Number | Select-Object Number, OperationalStatus, HealthStatus
Get-Volume | Where-Object DriveLetter -eq $partition.DriveLetter
```

## Install DCS server

https://www.digitalcombatsimulator.com/en/downloads/world/server/

## Install SRS

http://dcssimpleradio.com/

## Disable firewall

```powershell
$rules = @(
    @{Name="DCS Server"; Port=10308},
    @{Name="SRS Server"; Port=5002},
    @{Name="DCS Port 1"; Port=42674},
    @{Name="DCS Port 2"; Port=42675},
    @{Name="RDP"; Port=3389},
    @{Name="DCS Web Interface"; Port=8088}
)

foreach ($rule in $rules) {
    New-NetFirewallRule -DisplayName "$($rule.Name) TCP $($rule.Port)" `
        -Direction Inbound `
        -Protocol TCP `
        -LocalPort $rule.Port `
        -Action Allow `
        -Profile Any

    if ($rule.Port -ne 3389) {
        New-NetFirewallRule -DisplayName "$($rule.Name) UDP $($rule.Port)" `
            -Direction Inbound `
            -Protocol UDP `
            -LocalPort $rule.Port `
            -Action Allow `
            -Profile Any
    }
}

Get-NetFirewallRule | Where-Object { 
    $_.DisplayName -like "*TCP*" -or $_.DisplayName -like "*UDP*" 
} | Select-Object DisplayName, Enabled, Direction, Action | Sort-Object DisplayName
```

## Connect DCS and SRS

Create this as C:\link-srs-to-dcs.ps1

```powershell
$publicIP = (Invoke-WebRequest -Uri "http://ifconfig.me/ip" -UseBasicParsing).Content.Trim()
$content = Get-Content "F:\DCS-SimpleRadio-Standalone\Scripts\DCS-SRS-AutoConnectGameGUI.lua" -Raw
$content = $content -replace 'SRSAuto\.SERVER_SRS_HOST = "127\.0\.0\.1"', "SRSAuto.SERVER_SRS_HOST = `"$publicIP`""

$content | Set-Content "F:\DCS World Server\Scripts\Hooks\DCS-SRS-AutoConnectGameGUI.lua" -Force

if (Test-Path "F:\DCS World Server\Scripts\Hooks\DCS-SRS-AutoConnectGameGUI.lua") {
    Write-Host "File successfully created at F:\Hooks\DCS-SRS-AutoConnectGameGUI.lua"
    Write-Host "Public IP used: $publicIP"
} else {
    Write-Host "Error: File creation failed"
}
```

## Save snapshot of the DCS drive and the OS drive

In Azure UI, go to the VM -> settings -> disks -> select disk -> create snapshot.

# Running

Just `pulumi up` and it should work.