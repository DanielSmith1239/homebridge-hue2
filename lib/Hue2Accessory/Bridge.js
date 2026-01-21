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

import { Hue2Service } from '../Hue2Service/index.js'
import '../Hue2Service/Bridge.js'

const { HttpError } = HueClient

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
    this.missingRtypes = missingRtypes[params.config.modelid]

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
      .on('shutdown', this.shutdown)
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
      if (beat - this.pollBeat >= this.values.heartrate || this.pollNext) {
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
      timeout: this.platform.config.timeout,
      waitTimePut: this.platform.config.waitTimePut,
      waitTimePutGroup: this.platform.config.waitTimePutGroup,
      waitTimeResend: this.platform.config.waitTimeResend
    })
    this.client
      .on('error', (error) => {
        if (error instanceof HttpError) {
          if (error.request.id !== this.requestId) {
            this.log(
              'request %d: %s %s%s', error.request.id,
              error.request.method, error.request.resource,
              error.request.body == null ? '' : ' ' + error.request.body
            )
            this.requestId = error.request.id
          }
          this.warn('request %s: %s', error.request.id, error)
          return
        }
        this.warn(error)
      })
      .on('request', (request) => {
        this.debug(
          'request %d: %s %s%s', request.id,
          request.method, request.resource,
          request.body == null ? '' : ' ' + request.body
        )
        this.vdebug(
          'request %s: %s %s%s', request.id,
          request.method, request.url,
          request.body == null ? '' : ' ' + request.body
        )
      })
      .on('response', (response) => {
        this.vdebug(
          'request %d: response: %j', response.request.id,
          response.body
        )
        this.debug(
          'request %s: %d %s', response.request.id,
          response.statusCode, response.statusMessage
        )
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
        if (response.body != null) {
          this.vdebug(
            'request %d: response: %j', response.request.id, response.body
          )
        }
        this.debug(
          'request %d: %d %s', response.request.id,
          response.statusCode, response.statusMessage
        )
      })
      .on('listening', (url) => { this.log('listening on %s', url) })
      .on('closed', (url) => { this.log('connection to %s closed', url) })
      .on('changed', (resource, body) => {
        this.log('%s: %s', resource, this.jsonFormatter.stringify(body))
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
      if (this.context.fullState == null || this.pollFullState) {
        const fullState = await this.client.get('/resource')
        this.context.fullState = fullState
        // FIXME: workaround: some resource types aren't included in GET /resource
        for (const rtype of this.missingRtypes) {
          for (const item of await this.client.get('/' + rtype)) {
            fullState.push(item)
          }
        }
        // END FIXME
        // TODO add APIv1 resources for virtual devices not (yet) supported in APIv2,
        //      notably CLIP sensors, schedules, and rules
        this.pollFullState = false
        await this.analyseFullState(this.context.fullState, { logUnsupported: true })
      } else {
        const config = await this.client.get('/config')
        if (config.bridgeid === this.id && config.UTC == null) {
          this.values.expose = false
          this.values.apiKey = null
          await this.eventStream.close()
          return
        }
        this.context.fullState.config = config
        this.context.fullState.lights = await this.client.get('/lights')
        this.context.fullState.sensors = await this.client.get('/sensors')
        this.context.fullState.resourcelinks = await this.client.get('/resourcelinks')
        if (this.nDevicesByRtype.groups > 0) {
          this.context.fullState.groups = await this.client.get('/groups')
          try {
            this.context.fullState.groups[0] = await this.client.get('/groups/0')
          } catch (error) {}
        }
        if (this.values.exposeSchedules) {
          this.context.fullState.schedules = await this.client.get('/schedules')
        }
        await this.analyseFullState(this.context.fullState)
      }
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
  async analyseFullState (fullState, params = {}) {
    /** Supported devices by device ID.
      *
      * Updated by
      * {@link DeconzAccessory.Gateway#analyseFullState analyseFullState()}.
      * @type {Object<string, Deconz.Device>}
      */
    this.deviceById = {}

    /** Supported resources by resource path.
      *
      * Updated by {@link DeconzAccessory.Gateway#analyseFullState analyseFullState()}.
      * @type {Object<string, Deconz.Resource>}
      */
    this.resourceByRpath = {}

    /** Resources by resource ID by resource type.
      *
      * Updated by
      * {@link DeconzAccessory.Gateway#analyseFullState analyseFullState()}.
      * @type {Object<string, Object<string, Object>>}
      */
    this.resourceByRidByRtype = {}

    /** Number of supported devices by resource type.
      *
      * Updated by
      * {@link DeconzAccessory.Gateway#analyseFullState analyseFullState()}.
      * @type {Object<string, integer>}
      */
    this.nDevicesByRtype = {}

    this.vdebug('analysing resources...')
    for (const resource of fullState) {
      if (this.resourceByRidByRtype[resource.type] == null) {
        this.resourceByRidByRtype[resource.type] = {}
      }
      this.resourceByRidByRtype[resource.type][resource.id] = resource
    }
    for (const rtype in this.resourceByRidByRtype) {
      this.debug('%s: %d resources', rtype, Object.keys(this.resourceByRidByRtype[rtype]).length)
    }

    this.vdebug('analysing devices...')
    for (const rid in this.resourceByRidByRtype.device) {
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
      if (device.macAddress != null) {
        const id = device.macAddress?.replace(/:/g, '').toUpperCase()
        this.deviceById[id] = device
        this.log('%s: %s - %s', id, device.product_data.model_id, device.product_data.product_name)
        this.vdebug('%s: %s', id, this.jsonFormatter.stringify(device))
      }
    }
    this.vdebug('%d devices', Object.keys(this.deviceById).length)

    // this.analyseResourcelinks(params.logUnsupported)
    // for (const rtype of rtypes) {
    //   this.deviceByRidByRtype[rtype] = {}
    //   for (const rid in fullState[rtype]) {
    //     try {
    //       const body = fullState[rtype][rid]
    //       this.analyseResource(rtype, rid, body, params.logUnsupported)
    //     } catch (error) { this.error(error) }
    //   }
    // }

    /** Number of supported devices.
      *
      * Updated by
      * {@link DeconzAccessory.Gateway#analyseFullState analyseFullState()}.
      * @type {integer}
      */

    this.nDevices = Object.keys(this.deviceById).length

    /** Number of supported resources.
      *
      * Updated by
      * {@link DeconzAccessory.Gateway#analyseFullState analyseFullState()}.
      * @type {integer}
      */
    this.nResources = Object.keys(this.resourceByRpath).length

    this.debug('%d devices, %d resources', this.nDevices, this.nResources)
    // this.vdebug('%d devices, %d resources', this.nDevices, this.nResources)
    // for (const id in this.deviceById) {
    //   const device = this.deviceById[id]
    //   const { rtype, rid } = device.resource
    //   this.deviceByRidByRtype[rtype][rid] = device
    // }
    // for (const rtype of rtypes) {
    //   this.nDevicesByRtype[rtype] =
    //     Object.keys(this.deviceByRidByRtype[rtype]).length
    //   this.vdebug('%d %s devices', this.nDevicesByRtype[rtype], rtype)
    // }

    if (params.analyseOnly) {
      return
    }

    // this.update(fullState.config)

    // let changed = false
    const changed = true

    // this.vdebug('analysing accessories...')
    // for (const id in this.accessoryById) {
    //   try {
    //     if (
    //       this.deviceById[id] == null
    //     ) {
    //       delete this.context.settingsById[id]
    //       this.deleteAccessory(id)
    //       changed = true
    //     } else {
    //       /** Emitted when the gateway has been polled.
    //         * @event DeconzAccessory.Device#polled
    //         * @param {Deconz.Device} device - The updated device.
    //         */
    //       this.accessoryById[id].emit('polled', this.deviceById[id])
    //     }
    //   } catch (error) { this.error(error) }
    // }

    // for (const rtype of rtypes) {
    //   this.vdebug('analysing %s devices...', rtype)
    //   const rids = Object.keys(this.deviceByRidByRtype[rtype]).sort()
    //   for (const rid of rids) {
    //     try {
    //       const { id, resource, zigbee } = this.deviceByRidByRtype[rtype][rid]
    //       if (this.context.settingsById[id] == null) {
    //         this.context.settingsById[id] = { expose: zigbee && this.values.autoExpose }
    //       }
    //       if (this.context.settingsById[id].expose) {
    //         if (this.accessoryById[id] == null) {
    //           const name = resource.body.name
    //           if (zigbee && resource.body.type !== 'ZGPSwitch') {
    //             const mac = resource.body.uniqueid.split('-')[0]
    //             try {
    //               const ddf = await this.client.get('/devices/' + mac + '/ddf')
    //               if (ddf.status === 'Draft') {
    //                 this.warn('%s: exposed by legacy code', name)
    //               } else if (ddf.status !== 'Gold') {
    //                 this.warn('%s: exposed by %s ddf', name, ddf.status.toLowerCase())
    //               } else {
    //                 this.debug('%s: exposed by %s ddf', name, ddf.status.toLowerCase())
    //               }
    //             } catch (error) { }
    //           } else {
    //             this.debug('%s: exposed by legacy code', name)
    //           }
    //           await this.addAccessory(id)
    //           changed = true
    //         }
    //       } else {
    //         if (this.accessoryById[id] != null) {
    //           this.deleteAccessory(id)
    //           changed = true
    //         }
    //       }
    //     } catch (error) { this.error(error) }
    //   }
    // }

    this.nAccessories = Object.keys(this.accessoryById).length
    this.nResourcesMonitored = Object.keys(this.accessoryByRpath).length
    this.nExposeErrors = Object.keys(this.exposeErrorById).length
    if (this.nExposeErrors === 0) {
      this.vdebug('%d accessories', this.nAccessories)
    } else {
      this.vdebug(
        '%d accessories, %d expose errors', this.nAccessories, this.nExposeErrors
      )
    }

    // this.vdebug('analysing schedules...')
    // if (this.values.exposeSchedules) {
    //   if (DeconzService.Schedule == null) {
    //     await import('../DeconzService/Schedule.js')
    //   }
    //   for (const rid in fullState.schedules) {
    //     if (this.scheduleServicesByRid[rid] == null) {
    //       this.scheduleServicesByRid[rid] = new DeconzService.Schedule(
    //         this, rid, fullState.schedules[rid]
    //       )
    //     }
    //     this.scheduleServicesByRid[rid].update(fullState.schedules[rid])
    //   }
    // }
    // for (const rid in this.scheduleServicesByRid) {
    //   if (!this.values.exposeSchedules || fullState.schedules[rid] == null) {
    //     this.scheduleServicesByRid[rid].destroy()
    //     delete this.scheduleServicesByRid[rid]
    //   }
    // }

    if (changed) {
      // await this.updateMigration()
      this.identify()
    }
  }
}

Hue2Accessory.Bridge = Bridge
