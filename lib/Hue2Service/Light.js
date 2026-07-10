// homebridge-hue2/lib/Hue2Service/Light.js
// Copyright © 2023-2026 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Hue v2.

import { Colour } from 'homebridge-lib/Colour'

import { Hue2Service } from './index.js'

function gamutFromResource (resource) {
  const gamut = resource.color?.gamut
  if (
    gamut?.red?.x != null &&
    gamut?.red?.y != null &&
    gamut?.green?.x != null &&
    gamut?.green?.y != null &&
    gamut?.blue?.x != null &&
    gamut?.blue?.y != null
  ) {
    return {
      r: [gamut.red.x, gamut.red.y],
      g: [gamut.green.x, gamut.green.y],
      b: [gamut.blue.x, gamut.blue.y]
    }
  }
  return Colour.defaultGamut
}

class Light extends Hue2Service {
  constructor (accessory, resource, params = {}) {
    params.Service = params.isOutlet
      ? accessory.Services.hap.Outlet
      : accessory.Services.hap.Lightbulb
    super(accessory, resource, params)
    this.isOutlet = !!params.isOutlet
    this.gamut = gamutFromResource(resource)

    this.addCharacteristicDelegate({
      key: 'on',
      Characteristic: this.Characteristics.hap.On,
      value: resource.on?.on ?? false,
      setter: async (value) => {
        await this.put({ on: { on: value } })
      }
    })

    if (this.isOutlet) {
      this.addCharacteristicDelegate({
        key: 'outletInUse',
        Characteristic: this.Characteristics.hap.OutletInUse,
        value: true
      })
    }

    if (resource.dimming != null) {
      this.addCharacteristicDelegate({
        key: 'brightness',
        Characteristic: this.Characteristics.hap.Brightness,
        unit: '%',
        value: Math.round(resource.dimming.brightness ?? 100),
        setter: async (value) => {
          await this.put({
            on: { on: true },
            dimming: { brightness: Math.round(value) }
          })
        }
      })
    }

    if (resource.color_temperature?.mirek_schema != null || resource.color_temperature?.mirek != null) {
      const schema = resource.color_temperature?.mirek_schema
      this.addCharacteristicDelegate({
        key: 'colorTemperature',
        Characteristic: this.Characteristics.hap.ColorTemperature,
        props: schema == null
          ? undefined
          : {
              minValue: schema.mirek_minimum,
              maxValue: schema.mirek_maximum
            },
        value: resource.color_temperature?.mirek ?? resource.color_temperature?.mirek_schema?.mirek_minimum ?? 153,
        setter: async (value) => {
          await this.put({
            on: { on: true },
            color_temperature: { mirek: Math.round(value) }
          })
        }
      })
    }

    if (resource.color?.xy != null) {
      const { h, s } = Colour.xyToHsv(
        [resource.color.xy.x, resource.color.xy.y], this.gamut
      )
      this.addCharacteristicDelegate({
        key: 'hue',
        Characteristic: this.Characteristics.hap.Hue,
        unit: '˚',
        value: h,
        setter: async (value) => {
          await this.putColor(value, this.values.saturation ?? s)
        }
      })
      this.addCharacteristicDelegate({
        key: 'saturation',
        Characteristic: this.Characteristics.hap.Saturation,
        unit: '%',
        value: s,
        setter: async (value) => {
          await this.putColor(this.values.hue ?? h, value)
        }
      })
    }

    this.update(resource)
  }

  async putColor (hue, saturation) {
    const [x, y] = Colour.hsvToXy(
      Math.round(hue), Math.round(saturation), this.gamut
    )
    await this.put({
      on: { on: true },
      color: { xy: { x, y } }
    })
  }

  update (body) {
    super.update(body)
    if (body.on?.on != null) {
      this.values.on = body.on.on
      if (this.isOutlet && this.values.outletInUse != null) {
        this.values.outletInUse = true
      }
    }
    if (body.dimming?.brightness != null && this.values.brightness != null) {
      this.values.brightness = Math.round(body.dimming.brightness)
    }
    if (body.color_temperature?.mirek != null && this.values.colorTemperature != null) {
      this.values.colorTemperature = body.color_temperature.mirek
    }
    if (body.color?.xy != null && this.values.hue != null && this.values.saturation != null) {
      const { h, s } = Colour.xyToHsv(
        [body.color.xy.x, body.color.xy.y], this.gamut
      )
      this.values.hue = h
      this.values.saturation = s
    }
  }
}

Hue2Service.Light = Light
