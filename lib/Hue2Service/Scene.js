// homebridge-hue2/lib/Hue2Service/Scene.js
// Copyright © 2023-2026 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Hue v2.

import { ServiceDelegate } from 'homebridge-lib/ServiceDelegate'

import { Hue2Service } from './index.js'

class Scene extends ServiceDelegate {
  constructor (accessory, resource, params = {}) {
    params.Service = accessory.Services.hap.Switch
    super(accessory, params)
    this.accessory = accessory
    this.client = accessory.client
    this.action = params.action ?? 'active'
    this.update(resource)
    this.addCharacteristicDelegate({
      key: 'on',
      Characteristic: this.Characteristics.hap.On,
      value: false,
      setter: async (value) => {
        if (!value) {
          return
        }
        try {
          await this.recall()
        } finally {
          this.reset()
        }
      }
    })
  }

  async recall () {
    const recall = { action: this.action }
    if (this.action === 'dynamic_palette' && this.resource.speed != null) {
      recall.speed = this.resource.speed
    }
    await this.client.put(this.rpath, { recall })
  }

  reset () {
    clearTimeout(this.resetTimer)
    this.resetTimer = setTimeout(() => {
      this.values.on = false
    }, this.accessory.platform.config.waitTimeReset)
  }

  update (resource) {
    this.resource = resource
    this.rpath = `/${resource.type}/${resource.id}`
  }

  updateName (name) {
    this.values.name = name
    this.values.configuredName = name
  }

  destroy (delegateOnly = false) {
    clearTimeout(this.resetTimer)
    super.destroy(delegateOnly)
  }
}

Hue2Service.Scene = Scene
