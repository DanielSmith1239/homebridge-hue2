// homebridge-hue2/lib/Hue2Accessory/index.js
// Copyright © 2023-2026 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Hue v2.

import { AccessoryDelegate } from 'homebridge-lib/AccessoryDelegate'

class Hue2Accessory extends AccessoryDelegate {
  constructor (bridge, params) {
    super(bridge.platform, {
      ...params,
      logLevel: params.logLevel ?? bridge.logLevel
    })
    this.bridge = bridge
    this.client = bridge.client
    this.resourceServiceByRpath = {}
    this.resourcePaths = new Set()
  }

  registerResourceDelegate (resource, delegate) {
    const rpath = `/${resource.type}/${resource.id}`
    this.resourceServiceByRpath[rpath] = delegate
    this.resourcePaths.add(rpath)
    this.bridge.accessoryByRpath[rpath] = this
  }

  updateResource (rpath, body) {
    if (body?.metadata?.name != null && this.values.name !== body.metadata.name) {
      this.values.name = body.metadata.name
    }
    this.resourceServiceByRpath[rpath]?.update(body)
  }

  destroy (delegateOnly = false) {
    for (const rpath of this.resourcePaths) {
      if (this.bridge.accessoryByRpath[rpath] === this) {
        delete this.bridge.accessoryByRpath[rpath]
      }
    }
    super.destroy(delegateOnly)
  }
}

export { Hue2Accessory }
