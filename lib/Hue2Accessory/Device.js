// homebridge-hue2/lib/Hue2Accessory/Device.js
// Copyright © 2023-2026 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Hue v2.

import { Hue2Accessory } from './index.js'

import { Hue2Service } from '../Hue2Service/index.js'
import '../Hue2Service/Light.js'
import '../Hue2Service/Sensor.js'

function productData (device) {
  return device.product_data ?? {}
}

function accessoryName (device) {
  return device.metadata?.name ?? productData(device).product_name ?? device.id
}

function accessoryManufacturer (device) {
  return productData(device).manufacturer_name ?? 'Signify Netherlands B.V.'
}

function accessoryModel (device) {
  return productData(device).model_id ?? productData(device).product_name ?? device.type
}

function accessoryFirmware (device, bridge) {
  return productData(device).software_version ?? bridge.values.software
}

function accessoryCategory (bridge, device) {
  if (device.serviceByRidByRtype.light != null) {
    if (device.isOutlet) {
      return bridge.platform.Accessory.Categories.OUTLET
    }
    return bridge.platform.Accessory.Categories.LIGHTBULB
  }
  if (device.serviceByRidByRtype.contact != null) {
    return bridge.platform.Accessory.Categories.SENSOR
  }
  if (
    device.serviceByRidByRtype.motion != null ||
    device.serviceByRidByRtype.light_level != null ||
    device.serviceByRidByRtype.temperature != null
  ) {
    return bridge.platform.Accessory.Categories.SENSOR
  }
  return bridge.platform.Accessory.Categories.OTHER
}

class Device extends Hue2Accessory {
  constructor (bridge, device) {
    super(bridge, {
      id: device.serialNumber,
      name: accessoryName(device),
      manufacturer: accessoryManufacturer(device),
      model: accessoryModel(device),
      firmware: accessoryFirmware(device, bridge),
      category: accessoryCategory(bridge, device)
    })
    this.device = device
    this.context.deviceId = device.id
    this.context.serialNumber = device.serialNumber
    this.context.type = 'device'
    this.initialiseServices()
    this.emit('initialised')
  }

  initialiseServices () {
    const services = this.device.serviceByRidByRtype
    const light = Object.values(services.light ?? {})[0]
    if (light != null) {
      this.primaryService = new Hue2Service.Light(this, light, {
        primaryService: true,
        isOutlet: this.device.isOutlet
      })
    }
    const motion = Object.values(services.motion ?? {})[0]
    if (motion != null) {
      if (this.primaryService == null) {
        this.primaryService = new Hue2Service.Motion(this, motion, {
          primaryService: true
        })
      } else {
        this.motionService = new Hue2Service.Motion(this, motion)
      }
    }
    const contact = Object.values(services.contact ?? {})[0]
    if (contact != null) {
      if (this.primaryService == null) {
        this.primaryService = new Hue2Service.Contact(this, contact, {
          primaryService: true
        })
      } else {
        this.contactService = new Hue2Service.Contact(this, contact)
      }
    }
    const lightLevel = Object.values(services.light_level ?? {})[0]
    if (lightLevel != null) {
      if (this.primaryService == null) {
        this.primaryService = new Hue2Service.LightLevel(this, lightLevel, {
          primaryService: true
        })
      } else {
        this.lightLevelService = new Hue2Service.LightLevel(this, lightLevel)
      }
    }
    const temperature = Object.values(services.temperature ?? {})[0]
    if (temperature != null) {
      if (this.primaryService == null) {
        this.primaryService = new Hue2Service.Temperature(this, temperature, {
          primaryService: true
        })
      } else {
        this.temperatureService = new Hue2Service.Temperature(this, temperature)
      }
    }
    const battery = Object.values(services.device_power ?? {})[0]
    if (battery != null) {
      this.batteryService = new Hue2Service.Battery(this, battery)
    }
    this.registerResourceDelegate(this.device, {
      update: (body) => {
        if (body.metadata?.name != null) {
          this.values.name = body.metadata.name
        }
      }
    })
  }
}

Hue2Accessory.Device = Device
