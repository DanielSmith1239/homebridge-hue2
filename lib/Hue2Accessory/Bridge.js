// homebridge-hue2/lib/Hue2Accessory/Bridge.js
// Copyright © 2023-2026 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Hue v2.

import { timeout } from 'homebridge-lib'
import { AccessoryDelegate } from 'homebridge-lib/AccessoryDelegate'
import { JsonFormatter } from 'homebridge-lib/JsonFormatter'

import { HueClient } from 'hb-hue-tools/HueClient'
import { EventStreamClient } from 'hb-hue-tools/EventStreamClient'

import { Hue2Accessory } from './index.js'
import './Device.js'
import './Group.js'

import { Hue2Service } from '../Hue2Service/index.js'
import '../Hue2Service/Bridge.js'

const periodicEvents = [
  { rate: 60, event: 1002 },
  { rate: 3600, event: 1004 },
  { rate: 86400, event: 1003 }
]

const missingRtypes = {
  BSB002: ['homekit', 'motion_area_candidate'],
  BSB003: ['motion_area_candidate', 'wifi_connectivity']
}

/** Delegate class for a Hue bridge.
  * @extends AccessoryDelegate
  * @memberof Hue2Accessory
  */
class Bridge extends AccessoryDelegate {
  /** Instantiate a gateway delegate.
    * @param {DeconzPlatform} platform - The platform plugin.
    * @param {Object} params - Parameters.
    * @param {Object} params.config - The response body of an unauthenticated
    * GET `/config` (from {@link HueDiscovery#config config()}.
    * @param {string} params.host - The bridge hostname or IP address.
    */
  constructor (platform, params) {
    super(platform, {
      id: params.config.bridgeid,
      name: params.config.name,
      manufacturer: 'Signify Netherlands B.V.',
      model: params.config.modelid,
      firmware: params.config.apiversion,
      software: params.config.swversion,
      category: platform.Accessory.Categories.BRIDGE
    })

    this.bridge = this
    this.id = params.config.bridgeid
    this.recommendedFirmware = this.platform.packageJson.engines[params.config.modelid]
    this.missingRtypes = missingRtypes[params.config.modelid] ?? []

    /** Persisted properties.
      * @type {Object}
      * @property {Object} config - Response body of unauthenticated
      * GET `/config` (from {@link DeconzDiscovery#config config()}.
      * @property {Object} fullState - The gateway's full state, from the
      * last time the gateway was polled.
      * @property {Object.<String, Object>} settingsById - The persisted settings, maintained through
      * the Homebridge UI.
      */
    this.context // eslint-disable-line no-unused-expressions
    this.context.config = params.config
    if (this.context.settingsById == null) {
      this.context.settingsById = {}
    }

    this.addPropertyDelegate({
      key: 'apiKey',
      silent: true
    }).on('didSet', (value) => {
      this.client.apiKey = value
    })

    this.addPropertyDelegate({
      key: 'autoExpose',
      value: true,
      silent: true
    })

    this.addPropertyDelegate({
      key: 'expose',
      value: true,
      silent: true
    }).on('didSet', async (value) => {
      try {
        // this.service.values.statusActive = value
        if (value) {
          await this.connect()
        } else {
          // await this.reset()
        }
      } catch (error) { this.error(error) }
    })

    this.addPropertyDelegate({
      key: 'host',
      value: params.host,
      silent: true
    }).on('didSet', (value) => {
      if (this.client != null) {
        this.client.host = value
      }
    })

    this.values.logLevel = 2

    this.log(
      '%s bridge v%s API v%s', this.values.model,
      this.values.software, this.values.firmware
    )
    if (this.values.firmware !== this.recommendedFirmware) {
      this.warn(
        'recommended version: %s bridge API v%s',
        this.values.model, this.recommendedFirmware
      )
    }

    /** Map of Accessory delegates by id for the bridge.
      * @type {Object<string, Hue2Accessory>}
      */
    this.accessoryById = {}

    /** Map of Accessory delegates by rpath for the bridge.
      * @type {Object<string, Hue2Accessory>}
      */
    this.accessoryByRpath = {}

    this.defaultTransitionTime = 0.4

    /** Map of errors by device ID trying to expose the corresponding accessory.
      * @type {Object<string, Error>}
      */
    this.exposeErrorById = {}

    /** The service delegate for the Bridge Settings settings.
      * @type {DeconzService.Bridge}
      */
    this.service = new Hue2Service.Bridge(this, {
      name: this.name + ' Bridge',
      primaryService: true,
      host: params.host
    })

    this.jsonFormatter = new JsonFormatter()
    this.createClient()
    this.createEventStream()
    this.heartbeatEnabled = true
    this
      .on('identify', this.identify)
      .once('heartbeat', (beat) => { this.initialBeat = beat })
      .on('heartbeat', this.heartbeat)
  }

  get transitionTime () { return this.service.values.transitionTime }

  async resetTransitionTime () {
    if (this.resetting) {
      return
    }
    this.resetting = true
    await timeout(this.platform.config.waitTimeUpdate)
    this.service.values.transitionTime = this.defaultTransitionTime
    this.resetting = false
  }

  /** Log debug messages.
    */
  identify () {
    this.log(
      '%s bridge API v%s (%d accessories for %d devices, %d resources)',
      this.values.model, this.values.firmware,
      this.nAccessories, this.nDevices, this.nResourcesMonitored
    )
    if (this.values.firmware !== this.recommendedFirmware) {
      this.warn('recommended version: %s API v%s', this.values.model, this.recommendedFirmware)
    }
    if (this.context.migration != null) {
      this.log(
        'migration: %s: %d resources',
        this.context.migration, this.nResourcesMonitored
      )
    }
    if (this.logLevel > 2) {
      this.vdebug(
        '%d bridge resouces: %j', this.nResources,
        Object.keys(this.resourceByRpath).sort()
      )
      this.vdebug(
        '%d bridge devices: %j', this.nDevices,
        Object.keys(this.deviceById).sort()
      )
      this.vdebug(
        '%d accessories: %j', this.nAccessories,
        Object.keys(this.accessoryById).sort()
      )
      this.vdebug(
        'monitoring %d resources: %j', this.nResourcesMonitored,
        Object.keys(this.accessoryByRpath).sort()
      )
      const exposeErrors = Object.keys(this.exposeErrorById).sort()
      this.vdebug(
        '%d accessories with expose errors: %j', exposeErrors.length,
        exposeErrors
      )
      const settings = Object.keys(this.context.settingsById).sort()
      this.vdebug(
        'settings: %d devices: %j', settings.length, settings)
    }
  }

  async found (host, config) {
    try {
      this.values.host = host
      this.values.config = config
      this.values.software = config.swversion
      if (!this.initialised) {
        this.debug('initialising...')
        await this.connect()
      }
    } catch (error) {
      this.error(error)
    }
  }

  async shutdown () {
    this.service.values.statusActive = false
    return this.eventStream.close()
  }

  /** Called every second.
    * @param {integer} beat
    */
  async heartbeat (beat) {
    beat -= this.initialBeat
    try {
      if (this.values.periodicEvents && beat > 0) {
        for (const { rate, event } of periodicEvents) {
          if (beat % rate === 0) {
            this.buttonService.update(event)
          }
        }
      }
      if (beat - this.pollBeat >= this.service.values.heartrate || this.pollNext) {
        this.pollBeat = beat
        await this.poll()
      }
    } catch (error) { this.error(error) }
  }

  /** Create {@link Hue2Accessory.Bridge#client}.
    */
  createClient () {
    /** REST API client for the Hue bridge.
      * @type {HueClient}
      */
    this.client = new HueClient({
      apiKey: this.values.apiKey,
      config: this.context.config,
      host: this.values.host,
      maxSockets: this.platform.config.parallelRequests,
      logger: this,
      timeout: this.platform.config.timeout,
      waitTimePut: this.platform.config.waitTimePut,
      waitTimePutGroup: this.platform.config.waitTimePutGroup,
      waitTimeResend: this.platform.config.waitTimeResend
    })
  }

  /** Create {@link Hue2Accessory.Bridge#eventStream}.
    */
  createEventStream () {
    /** Client for bridge event stream notifications.
      * @type {EventStreamClient}
      */
    this.eventStream = new EventStreamClient(this.client, { version: 2 })
    this.eventStream
      .on('error', (error) => {
        this.warn('event stream error: %s', error)
        this.log(
          'request %d: %s %s', error.request.id,
          error.request.method, error.request.resource
        )
        this.warn('request %d: %s', error.request.id, error)
      })
      .on('request', (request) => {
        if (request.body == null) {
          this.debug(
            'request %d: %s %s', request.id, request.method, request.resource
          )
          this.vdebug(
            'request %d: %s %s', request.id, request.method, request.url
          )
        } else {
          this.debug(
            'request %d: %s %s %s', request.id,
            request.method, request.resource, request.body
          )
          this.vdebug(
            'request %d: %s %s %s', request.id,
            request.method, request.url, request.body
          )
        }
      })
      .on('response', (response) => {
        this.debug(
          'request %d: %d %s', response.request.id,
          response.statusCode, response.statusMessage
        )
        if (response.body != null) {
          this.vdebug(
            'request %d: response: %j', response.request.id, response.body
          )
        }
      })
      .on('listening', (url) => { this.log('listening on %s', url) })
      .on('closed', (url) => { this.log('connection to %s closed', url) })
      .on('changed', (resource, body) => {
        this.debug('%s: %s', resource, this.jsonFormatter.stringify(body))
        this.accessoryByRpath[resource]?.updateResource(resource, body)
      })
      .on('notification', (body) => {
        this.debug(this.jsonFormatter.stringify(body))
      })
      .on('data', (s) => { this.vdebug('data: %s', s) })
  }

  /** Connect to the Hue bridge.
    *
    * Try for two minutes to obtain an API key, when no API key is available.
    * When the API key has been obtained, connect to the event stream, poll the
    * bridge, and analyse the full state.
    */
  async connect (retry = 0) {
    if (!this.values.expose) {
      this.warn('press bridge button and set expose to obtain an API key')
      return
    }
    try {
      if (this.values.apiKey == null) {
        this.values.apiKey = await this.client.getApiKey('homebridge-hue2')
      }
      this.eventStream.listen()
      this.service.values.restart = false
      this.service.values.statusActive = true
      this.checkApiKeys = true
      for (const id in this.exposeErrorById) {
        this.resetExposeError(id)
      }
      this.pollNext = true
      this.pollFullState = true
    } catch (error) {
      if (
        error instanceof HueClient.HueError && retry < 8
      ) {
        this.warn('press bridge button tp obtain API key - retrying in 15s')
        await timeout(15000)
        return (this.connect(retry + 1))
      }
      this.error(error)
      this.values.expose = false
    }
  }

  /** Reset the bridge delegate.
    *
    * Delete the API key from the bridge.
    * Close the event stream connection.
    * Delete all accessories and services associated to devices exposed by
    * the bridge.
    */
  async reset () {
    if (this.values.apiKey == null) {
      return
    }
    try {
      try {
        // await this.deleteMigration()
        await this.client.deleteApiKey()
      } catch (error) {}
      this.values.apiKey = null
      await this.eventStream.close()
      for (const id in this.accessoryById) {
        if (id !== this.id) {
          this.deleteAccessory(id)
        }
      }
      this.exposeErrors = {}
      this.context.settingsById = {}
      this.context.fullState = null
    } catch (error) { this.error(error) }
  }

  // ===========================================================================

  /** Poll the bridge.
    *
    * Periodically get the bridge full state and call
    * {@link DeconzAccessory.Bridge#analyseFullState()}.<br>
    */
  async poll () {
    if (this.polling || this.values.apiKey == null) {
      return
    }
    try {
      this.polling = true
      this.vdebug('%spolling...', this.pollNext ? 'priority ' : '')
      const fullState = await this.client.get('/resource')
      this.context.fullState = fullState
      for (const rtype of this.missingRtypes) {
        for (const item of await this.client.get('/' + rtype)) {
          fullState.push(item)
        }
      }
      this.pollFullState = false
      await this.analyseFullState(this.context.fullState)
    } catch (error) {
      this.error('poll error: %s', error)
    } finally {
      this.vdebug('polling done')
      this.pollNext = false
      this.polling = false
    }
    if (!this.initialised) {
      this.initialised = true
      this.debug('initialised')
      this.emit('initialised')
    }
  }

  /** Analyse the peristed full state of the bridge
    * adding, re-configuring, and deleting delegates for corresponding HomeKit
    * accessories and services.
    *
    * The analysis consists of the following steps:
    * 1. Analyse the resources, updating:
    * {@link DeconzAccessory.Gateway#resourceByRidByRtype resourceByRidByRtype},
    * {@link DeconzAccessory.Gateway#deviceById deviceById},
    * {@link DeconzAccessory.Gateway#nDevices nDevices},
    * {@link DeconzAccessory.Gateway#nDevicesByRtype nDevicesByRtype},
    * {@link DeconzAccessory.Gateway#nResources nResources},
    * {@link DeconzAccessory.Gateway#resourceByRpath resourceByRpath}.
    * 2. Analyse (pre-existing) _Device_ accessories, emitting
    * {@link DeconzAccessory.Device#event.polled}, and calling
    * {@link DeconzAccessory.Gateway#deleteAccessory deleteAccessory()} for
    * stale accessories, corresponding to devices that have been deleted from
    * the gateway, blacklisted, or excluded by device primary resource type.
    * 3. Analysing supported devices with enabled device primary resource types,
    * calling {@link DeconzAccessory.Gateway#addAccessory addAccessory()} for new
    * _Device_ accessories, corresponding to devices added to the gateway,
    * un-blacklisted, or included by device primary resource type, and calling
    * {@link DeconzAccessory.Gateway#deleteAccessory deleteAccessory()} for
    * accessories, corresponding to devices have been blacklisted.
    * @param {Object} fullState - The gateway full state, as returned by
    * {@link DeconzAccessory.Gateway#poll poll()}.
    * @param {Object} params - Parameters
    * @param {boolean} [params.logUnsupported=false] - Issue debug
    * messsages for unsupported resources.
    * @param {boolean} [params.analyseOnly=false]
    */
  async analyseFullState (fullState) {
    this.deviceById = {}
    this.resourceByRpath = {}
    this.resourceByRidByRtype = {}
    for (const resource of fullState) {
      resource.rpath = `/${resource.type}/${resource.id}`
      this.resourceByRpath[resource.rpath] = resource
      if (this.resourceByRidByRtype[resource.type] == null) {
        this.resourceByRidByRtype[resource.type] = {}
      }
      this.resourceByRidByRtype[resource.type][resource.id] = resource
    }
    const seenIds = new Set()
    for (const rid in this.resourceByRidByRtype.device ?? {}) {
      const device = this.resourceByRidByRtype.device[rid]
      device.serviceByRidByRtype = {}
      for (const { rid, rtype } of device.services) {
        if (device.serviceByRidByRtype[rtype] == null) {
          device.serviceByRidByRtype[rtype] = {}
        }
        device.serviceByRidByRtype[rtype][rid] = this.resourceByRidByRtype[rtype]?.[rid]
        if (rtype === 'zigbee_connectivity') {
          device.macAddress = device.serviceByRidByRtype.zigbee_connectivity[rid].mac_address
        } else if (rtype === 'zgp_connectivity') {
          device.macAddress = device.serviceByRidByRtype.zgp_connectivity[rid].source_id
        }
      }
      device.serialNumber = (
        device.macAddress?.replace(/:/g, '').toUpperCase() ?? device.id.toUpperCase()
      )
      device.isOutlet = (device.product_data?.product_archetype ?? '')
        .toLowerCase().includes('plug')
      if (
        device.serviceByRidByRtype.light != null ||
        device.serviceByRidByRtype.motion != null ||
        device.serviceByRidByRtype.contact != null ||
        device.serviceByRidByRtype.light_level != null ||
        device.serviceByRidByRtype.temperature != null
      ) {
        this.deviceById[device.serialNumber] = device
        seenIds.add(device.serialNumber)
        if (this.accessoryById[device.serialNumber] == null) {
          this.accessoryById[device.serialNumber] =
            new Hue2Accessory.Device(this, device)
        } else {
          this.accessoryById[device.serialNumber].updateResource(
            `/${device.type}/${device.id}`, device
          )
          for (const resourceMap of Object.values(device.serviceByRidByRtype)) {
            for (const resource of Object.values(resourceMap ?? {})) {
              if (resource != null) {
                this.accessoryById[device.serialNumber].updateResource(
                  `/${resource.type}/${resource.id}`, resource
                )
              }
            }
          }
        }
      }
    }
    for (const type of ['room', 'zone']) {
      for (const group of Object.values(this.resourceByRidByRtype[type] ?? {})) {
        const service = group.services?.find((service) => service.rtype === 'grouped_light')
        const groupedLight = service == null
          ? null
          : this.resourceByRidByRtype.grouped_light?.[service.rid]
        if (groupedLight != null) {
          const id = `${group.type}:${group.id}`
          seenIds.add(id)
          if (this.accessoryById[id] == null) {
            this.accessoryById[id] = new Hue2Accessory.Group(this, group, groupedLight)
          } else {
            this.accessoryById[id].updateResource(`/${group.type}/${group.id}`, group)
            this.accessoryById[id].updateResource(
              `/${groupedLight.type}/${groupedLight.id}`, groupedLight
            )
          }
        }
      }
    }
    for (const id of Object.keys(this.accessoryById)) {
      if (!seenIds.has(id)) {
        this.deleteAccessory(id)
      }
    }
    this.nDevices = Object.keys(this.deviceById).length
    this.nResources = Object.keys(this.resourceByRpath).length
    this.nAccessories = Object.keys(this.accessoryById).length
    this.nResourcesMonitored = Object.keys(this.accessoryByRpath).length
    this.nExposeErrors = Object.keys(this.exposeErrorById).length
    this.service.update()
    this.identify()
  }

  deleteAccessory (id) {
    const accessory = this.accessoryById[id]
    if (accessory == null) {
      return
    }
    accessory.destroy()
    delete this.accessoryById[id]
  }

  resetExposeError (id) {
    delete this.exposeErrorById[id]
  }
}

Hue2Accessory.Bridge = Bridge
