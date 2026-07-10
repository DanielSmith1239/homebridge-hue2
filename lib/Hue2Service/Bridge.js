// homebridge-hue2/lib/Hue2Service/Bridge.js
// Copyright © 2023-2026 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Hue v2.

import { ServiceDelegate } from 'homebridge-lib/ServiceDelegate'

import { Hue2Service } from './index.js'

/** Delegate class for a Hue2Bridge service.
  * @extends ServiceDelegate
  * @memberof Hue2Service
  */
class Bridge extends ServiceDelegate {
  constructor (bridge, params = {}) {
    params.Service = bridge.Services.my.HueBridge
    super(bridge, params)
    this.bridge = bridge

    this.addCharacteristicDelegate({
      key: 'heartrate',
      Characteristic: this.Characteristics.my.Heartrate,
      unit: 's',
      value: 5
    })

    this.addCharacteristicDelegate({
      key: 'lastUpdated',
      Characteristic: this.Characteristics.my.LastUpdated,
      silent: true
    })

    this.addCharacteristicDelegate({
      key: 'statusActive',
      Characteristic: this.Characteristics.hap.StatusActive,
      value: true,
      silent: true
    })

    this.addCharacteristicDelegate({
      key: 'search',
      Characteristic: this.Characteristics.my.Search,
      value: false
    }).on('didSet', async (value, fromHomeKit) => {
      if (fromHomeKit) {
        if (value) {
          try {
            await this.bridge.client.search()
          } catch (error) {
            this.warn(error)
          } finally {
            this.values.search = false
          }
        }
      }
    })

    this.addCharacteristicDelegate({
      key: 'restart',
      Characteristic: this.Characteristics.my.Restart,
      value: false
    }).on('didSet', async (value, fromHomeKit) => {
      if (fromHomeKit && value) {
        try {
          await this.bridge.client.restart()
        } catch (error) {
          this.warn(error)
        } finally {
          this.values.restart = false
        }
      }
    })

    this.addCharacteristicDelegate({
      key: 'transitionTime',
      Characteristic: this.Characteristics.my.TransitionTime,
      value: this.bridge.defaultTransitionTime
    })
    this.values.transitionTime = this.bridge.defaultTransitionTime
  }

  update (config) {
    this.values.expose = true
    this.values.lastUpdated = new Date().toString().slice(0, 24)
  }
}

Hue2Service.Bridge = Bridge
