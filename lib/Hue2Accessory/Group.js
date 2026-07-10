// homebridge-hue2/lib/Hue2Accessory/Group.js
// Copyright © 2023-2026 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Hue v2.

import { Hue2Accessory } from './index.js'

import { Hue2Service } from '../Hue2Service/index.js'
import '../Hue2Service/Light.js'

class Group extends Hue2Accessory {
  constructor (bridge, group, groupedLight) {
    super(bridge, {
      id: `${group.type}:${group.id}`,
      name: group.metadata?.name ?? group.id,
      manufacturer: 'Signify Netherlands B.V.',
      model: group.type,
      firmware: bridge.values.software,
      category: bridge.platform.Accessory.Categories.LIGHTBULB
    })
    this.group = group
    this.context.groupId = group.id
    this.context.groupedLightId = groupedLight.id
    this.context.type = group.type
    this.primaryService = new Hue2Service.Light(this, groupedLight, {
      name: group.metadata?.name,
      primaryService: true
    })
    this.registerResourceDelegate(group, {
      update: (body) => {
        if (body.metadata?.name != null) {
          this.values.name = body.metadata.name
          this.primaryService.values.configuredName = body.metadata.name
        }
      }
    })
    this.emit('initialised')
  }
}

Hue2Accessory.Group = Group
