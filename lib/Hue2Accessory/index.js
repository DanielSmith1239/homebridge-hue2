// homebridge-hue2/lib/Hue2Accessory/index.js
// Copyright © 2023-2025 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Hue v2.

import { AccessoryDelegate } from 'homebridge-lib/AccessoryDelegate'

class Hue2Accessory extends AccessoryDelegate {
  constructor (bridge, device, category) {
    super(bridge.platform, {
      id: device.id,
      name: device.name,
      manufacturer: device.manufacturer,
      model: device.model,
      firmware: device.firmware,
      category,
      logLevel: bridge.logLevel
    })
  }
}

export { Hue2Accessory }
