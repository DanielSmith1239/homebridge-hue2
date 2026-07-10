// homebridge-hue2/lib/Hue2Service/index.js
// Copyright © 2023-2026 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Hue v2.

import { ServiceDelegate } from 'homebridge-lib/ServiceDelegate'

import { HueClient } from 'hb-hue-tools/HueClient'

const { HttpError } = HueClient

class Hue2Service extends ServiceDelegate {
  constructor (accessory, resource, params = {}) {
    super(accessory, {
      name: params.name ?? resource.metadata?.name ?? accessory.name,
      Service: params.Service,
      subtype: params.subtype,
      primaryService: params.primaryService
    })
    this.bridge = accessory.bridge
    this.accessory = accessory
    this.client = accessory.client
    this.resource = resource
    this.rtype = resource.type
    this.rid = resource.id
    this.rpath = `/${resource.type}/${resource.id}`
    accessory.registerResourceDelegate(resource, this)
  }

  async put (body) {
    this.debug('PUT %s %j', this.rpath, body)
    try {
      await this.client.put(this.rpath, body)
    } catch (error) {
      if (!(error instanceof HttpError)) {
        this.warn(error)
      }
    }
  }

  update (body) {
    if (body?.metadata?.name != null && this.values.configuredName != null) {
      this.values.configuredName = body.metadata.name
    }
  }

  static lightLevelToLux (lightLevel) {
    if (lightLevel == null) {
      return 0.0001
    }
    const lux = Math.pow(10, (lightLevel - 1) / 10000)
    return Math.max(0.0001, Math.min(100000, lux))
  }
}

export { Hue2Service }
