// homebridge-hue2/lib/Hue2Service/Sensor.js
// Copyright © 2023-2026 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Hue v2.

import { ServiceDelegate } from 'homebridge-lib/ServiceDelegate'
import 'homebridge-lib/ServiceDelegate/Battery'

import { Hue2Service } from './index.js'

class Motion extends Hue2Service {
  constructor (accessory, resource, params = {}) {
    params.Service = accessory.Services.hap.MotionSensor
    super(accessory, resource, params)
    this.addCharacteristicDelegate({
      key: 'motionDetected',
      Characteristic: this.Characteristics.hap.MotionDetected,
      value: resource.motion?.motion ?? false
    })
    this.update(resource)
  }

  update (body) {
    super.update(body)
    if (body.motion?.motion_valid && body.motion.motion != null) {
      this.values.motionDetected = body.motion.motion
    }
  }
}

class Contact extends Hue2Service {
  constructor (accessory, resource, params = {}) {
    params.Service = accessory.Services.hap.ContactSensor
    super(accessory, resource, params)
    this.addCharacteristicDelegate({
      key: 'contactSensorState',
      Characteristic: this.Characteristics.hap.ContactSensorState,
      value: this.Characteristics.hap.ContactSensorState.CONTACT_DETECTED
    })
    this.update(resource)
  }

  update (body) {
    super.update(body)
    const state = body.contact?.state ?? body.contact_report?.state
    if (state != null) {
      const contactSensorState = state === 'contact'
        ? this.Characteristics.hap.ContactSensorState.CONTACT_DETECTED
        : this.Characteristics.hap.ContactSensorState.CONTACT_NOT_DETECTED
      this.values.contactSensorState = contactSensorState
    }
  }
}

class Temperature extends Hue2Service {
  constructor (accessory, resource, params = {}) {
    params.Service = accessory.Services.hap.TemperatureSensor
    super(accessory, resource, params)
    this.addCharacteristicDelegate({
      key: 'currentTemperature',
      Characteristic: this.Characteristics.hap.CurrentTemperature,
      unit: '°C',
      value: 0
    })
    this.update(resource)
  }

  update (body) {
    super.update(body)
    if (body.temperature?.temperature_valid && body.temperature.temperature != null) {
      this.values.currentTemperature =
        Math.round(body.temperature.temperature * 10) / 10
    }
  }
}

class LightLevel extends Hue2Service {
  constructor (accessory, resource, params = {}) {
    params.Service = accessory.Services.hap.LightSensor
    super(accessory, resource, params)
    this.addCharacteristicDelegate({
      key: 'currentAmbientLightLevel',
      Characteristic: this.Characteristics.hap.CurrentAmbientLightLevel,
      unit: 'lux',
      value: 0.0001
    })
    this.update(resource)
  }

  update (body) {
    super.update(body)
    if (body.light?.light_level_valid && body.light.light_level != null) {
      this.values.currentAmbientLightLevel =
        Hue2Service.lightLevelToLux(body.light.light_level)
    }
  }
}

class Battery extends ServiceDelegate.Battery {
  constructor (accessory, resource, params = {}) {
    super(accessory, {
      batteryLevel: 100,
      ...params
    })
    this.resource = resource
    this.rpath = `/${resource.type}/${resource.id}`
    accessory.registerResourceDelegate(resource, this)
    this.update(resource)
  }

  update (body) {
    if (body.power_state?.battery_level != null) {
      this.values.batteryLevel = Math.round(body.power_state.battery_level)
    }
  }
}

Hue2Service.Motion = Motion
Hue2Service.Contact = Contact
Hue2Service.Temperature = Temperature
Hue2Service.LightLevel = LightLevel
Hue2Service.Battery = Battery
