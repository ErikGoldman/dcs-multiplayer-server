import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";

// Resource group
const resourceGroupName = "DcsMultiplayerServer";
const resourceGroupLocation = "northcentralus";
const hoursBeforeShutdown = 6;

// Virtual Network
const virtualNetwork = new azure.network.VirtualNetwork("dcs-server-vnet", {
  resourceGroupName: resourceGroupName,
  addressSpace: {
    addressPrefixes: ["10.0.0.0/16"],
  },
});

const subnet = new azure.network.Subnet("example-subnet", {
  resourceGroupName: resourceGroupName,
  virtualNetworkName: virtualNetwork.name,
  addressPrefix: "10.0.1.0/24",
});

// Public IP
const publicIp = new azure.network.PublicIPAddress("dcs-server-public-ip", {
  resourceGroupName: resourceGroupName,
  publicIPAllocationMethod: azure.network.IPAllocationMethod.Static,
  location: resourceGroupLocation,
  sku: {
    name: azure.network.PublicIPAddressSkuName.Standard,
  },
});

// Network Security Group with rules to open specified ports, including RDP (3389)
const networkSecurityGroup = new azure.network.NetworkSecurityGroup(
  "dcs-server-nsg",
  {
    resourceGroupName: resourceGroupName,
    securityRules: [
      {
        name: "dcs-in-tcp",
        protocol: "Tcp",
        direction: "Inbound",
        access: "Allow",
        priority: 1001,
        sourcePortRange: "*",
        destinationPortRange: "10308",
        sourceAddressPrefix: "*",
        destinationAddressPrefix: "*",
      },
      {
        name: "dcs-in-udp",
        protocol: "Udp",
        direction: "Inbound",
        access: "Allow",
        priority: 1002,
        sourcePortRange: "*",
        destinationPortRange: "10308",
        sourceAddressPrefix: "*",
        destinationAddressPrefix: "*",
      },
      {
        name: "dcs-webgui-in-tcp",
        protocol: "Tcp",
        direction: "Inbound",
        access: "Allow",
        priority: 1100,
        sourcePortRange: "*",
        destinationPortRange: "8088",
        sourceAddressPrefix: "*",
        destinationAddressPrefix: "*",
      },
      {
        name: "dcs-webgui-in-udp",
        protocol: "Udp",
        direction: "Inbound",
        access: "Allow",
        priority: 1101,
        sourcePortRange: "*",
        destinationPortRange: "8088",
        sourceAddressPrefix: "*",
        destinationAddressPrefix: "*",
      },
      {
        name: "srs-in-tcp",
        protocol: "Tcp",
        direction: "Inbound",
        access: "Allow",
        priority: 1003,
        sourcePortRange: "*",
        destinationPortRange: "5002",
        sourceAddressPrefix: "*",
        destinationAddressPrefix: "*",
      },
      {
        name: "srs-in-udp",
        protocol: "Udp",
        direction: "Inbound",
        access: "Allow",
        priority: 1004,
        sourcePortRange: "*",
        destinationPortRange: "5002",
        sourceAddressPrefix: "*",
        destinationAddressPrefix: "*",
      },
      {
        name: "tacview-in-tcp",
        protocol: "Tcp",
        direction: "Inbound",
        access: "Allow",
        priority: 1005,
        sourcePortRange: "*",
        destinationPortRange: "42674-42675",
        sourceAddressPrefix: "*",
        destinationAddressPrefix: "*",
      },
      {
        name: "tacview-in-udp",
        protocol: "Udp",
        direction: "Inbound",
        access: "Allow",
        priority: 1006,
        sourcePortRange: "*",
        destinationPortRange: "42674-42675",
        sourceAddressPrefix: "*",
        destinationAddressPrefix: "*",
      },
      {
        name: "rdp-in",
        protocol: "Tcp",
        direction: "Inbound",
        access: "Allow",
        priority: 1009,
        sourcePortRange: "*",
        destinationPortRange: "3389",
        sourceAddressPrefix: "*",
        destinationAddressPrefix: "*",
      }, // RDP port
    ],
  }
);

// Network Interface with attached NSG
const networkInterface = new azure.network.NetworkInterface("dcs-server-nic", {
  resourceGroupName: resourceGroupName,
  ipConfigurations: [
    {
      name: "ipconfig1",
      subnet: {
        id: subnet.id,
      },
      privateIPAllocationMethod: azure.network.IPAllocationMethod.Dynamic,
      publicIPAddress: {
        id: publicIp.id, // Associate the public IP with the NIC
      },
    },
  ],
  networkSecurityGroup: { id: networkSecurityGroup.id },
});

const config = new pulumi.Config();
const adminPassword = config.requireSecret("adminPassword"); // Retrieves the password securely

const osHddSnapshot = azure.compute.getSnapshot({
  snapshotName: "dcsOsHdd",
  resourceGroupName,
});
const dcsHddSnapshot = azure.compute.getSnapshot({
  snapshotName: "dcsDcsHdd",
  resourceGroupName,
});

const osManagedDisk = pulumi.all([osHddSnapshot]).apply(([snapshot]) => {
  return new azure.compute.Disk("osManagedDisk", {
    resourceGroupName: resourceGroupName,
    location: resourceGroupLocation, // This should match the snapshot location
    diskSizeGB: 256, // Set the size from the snapshot
    creationData: {
      createOption: "Copy", // Use "Copy" to create from the snapshot
      sourceResourceId: snapshot.id, // Reference the snapshot ID
    },
    sku: {
      name: "Premium_LRS",
    },
  });
}) as any;

const dcsManagedDisk = pulumi.all([dcsHddSnapshot]).apply(([snapshot]) => {
  return new azure.compute.Disk("dcsManagedDisk", {
    resourceGroupName: resourceGroupName,
    location: resourceGroupLocation, // This should match the snapshot location
    diskSizeGB: 1024, // Set the size from the snapshot
    creationData: {
      createOption: "Copy", // Use "Copy" to create from the snapshot
      sourceResourceId: snapshot.id, // Reference the snapshot ID
    },
    sku: {
      name: "Premium_LRS",
    },
  });
}) as any;

const vm = pulumi
  .all([osManagedDisk.id, dcsManagedDisk.id])
  .apply(([osDiskId, dcsDiskId]) => {
    // Virtual Machine
    const vm = new azure.compute.VirtualMachine("dcs-server-vm", {
      resourceGroupName: resourceGroupName,
      hardwareProfile: { vmSize: "Standard_E4as_v4" },
      networkProfile: { networkInterfaces: [{ id: networkInterface.id }] },
      additionalCapabilities: { ultraSSDEnabled: true },
      storageProfile: {
        osDisk: {
          caching: "ReadWrite",
          managedDisk: {
            id: osDiskId,
          },
          createOption: "Attach",
          osType: "Windows",
        },
        dataDisks: [
          {
            lun: 0,
            caching: "ReadWrite",
            managedDisk: {
              id: dcsDiskId,
            },
            createOption: "Attach",
          },
        ],
      },
    });

    const runSrsDcsLink = new azure.compute.VirtualMachineExtension(
      "startup-script",
      {
        resourceGroupName,
        type: "CustomScriptExtension",
        typeHandlerVersion: "1.10",
        publisher: "Microsoft.Compute",
        settings: {
          fileUris: [], // No external URLs, but can be used if script needs to download resources
          commandToExecute: `powershell -Command "Start-Process 'F:\\DCS-SimpleRadio-Standalone\\SR-Server.exe' -WorkingDirectory 'F:\\DCS-SimpleRadio-Standalone'; 'C:\\link-srs-to-dcs.ps1'"`,
        },
        vmName: vm.name,
      }
    );
    /*
    const automationAccount = new azure.automation.AutomationAccount(
      "automationAccount",
      {
        resourceGroupName: resourceGroupName,
        location: resourceGroupLocation,
        sku: { name: "Basic" },
        name: "myAutomationAccount",
      }
    );

    // Create a Runbook to delete the VM
    const deleteVmRunbook = new azure.automation.Runbook("deleteVmRunbook", {
      resourceGroupName: resourceGroupName,
      automationAccountName: automationAccount.name,
      name: "DeleteVmAfter6Hours",
      logVerbose: true,
      logProgress: true,
      runbookType: "PowerShell",
      publishContentLink: {
        uri: "https://dcsmultiplayerscriptseg.blob.core.windows.net/scripts/deleteVm.ps1",
      },
    });

    // Schedule the Runbook to run after 6 hours
    const schedule = new azure.automation.Schedule("deleteVmSchedule", {
      name: "deleteVmSchedule",
      startTime: new Date(Date.now()).toUTCString(),
      resourceGroupName: resourceGroupName,
      automationAccountName: automationAccount.name,
      frequency: "Hour",
      interval: hoursBeforeShutdown,
      timeZone: "UTC",
    });

    // Link the Schedule to the Runbook with a Job
    const job = new azure.automation.JobSchedule("deleteVmJob", {
      resourceGroupName: resourceGroupName,
      automationAccountName: automationAccount.name,
      runbook: { name: deleteVmRunbook.name },
      schedule: {
        name: schedule.name,
      },
      parameters: {
        ResourceGroupName: resourceGroupName,
        VmName: vm.name,
      },
    });
    */
  });

export const publicIpAddress = publicIp.ipAddress;
