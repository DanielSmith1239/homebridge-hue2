// homebridge-hue2/lib/Hue2Service/index.js
// Copyright © 2023-2026 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Hue v2.

import { ServiceDelegate } from 'homebridge-lib/ServiceDelegate'

import { HueClient } from 'hb-hue-tools/HueClient'

const { HttpError, dateToString } = HueClient

class Hue2Service extends ServiceDelegate {
  constructor (accessory, resource, params) {
    super(accessory, {
      id: resource.id,
      name: params.name ?? resource.body.name,
      Service: params.Service,
      subtype: resource.subtype,
      primaryService: params.primaryService,
      exposeConfiguredName: true
    })
    this.id = resource.id
    this.bridge = accessory.bridge
    this.accessory = accessory
    this.client = accessory.client
    this.resource = resource
    this.rtype = resource.rtype
    this.rid = resource.rid
    this.rpath = resource.rpath
    this.capabilities = resource.capabilities

    this.serviceNameByRpath = {}

    // this.characteristicDelegate('configuredName')
    //   .on('didSet', async (value, fromHomeKit) => {
    //     if (fromHomeKit && value != null && value !== '') {
    //       this.debug('PUT %s %j', this.rpath, { name: value })
    //       await this.client.put(this.rpath, { name: value })
    //     }
    //   })
  }

  addResource (resource) {
    this.serviceNameByRpath[resource.rpath] = resource.serviceName
    Hue2Service[resource.serviceName].addResource(this, resource)
  }

  update (body, rpath) {
    if (this.updating) {
      return
    }
    const serviceName = this.serviceNameByRpath[rpath]
    if (serviceName != null) {
      if (body.state != null) {
        Hue2Service[serviceName].updateResourceState(this, body.state)
      }
      return
    }
    // if (body.name != null) {
    //   this.values.configuredName = body.name.slice(0, 31).trim()
    // }
    if (body.lastseen != null && this.rtype === 'lights') {
      this.values.lastSeen = dateToString(body.lastseen)
    }
    if (body.config != null) {
      this.updateConfig(body.config)
      if (this.batteryService != null) {
        this.batteryService.updateConfig(body.config)
      }
    }
    if (body.state != null) {
      this.updateState(body.state, rpath)
    }
    if (this.rtype === 'groups') {
      if (body.action != null) {
        this.updateState(body.action, rpath, 'action')
      }
      if (body.scenes != null) {
        this.updateScenes(body.scenes)
      }
    }
  }

  async put (path, body) {
    this.debug('PUT %s %j', path, body)
    try {
      await this.client.put(this.rpath + path, body)
    } catch (error) {
      if (!(error instanceof HttpError)) {
        this.warn(error)
      }
    }
  }
}

export { Hue2Service }
