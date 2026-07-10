// homebridge-hue2/lib/Hue2Accessory/Group.js
// Copyright © 2023-2026 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Hue v2.

import { Hue2Accessory } from './index.js'

import { Hue2Service } from '../Hue2Service/index.js'
import '../Hue2Service/Light.js'
import '../Hue2Service/Scene.js'

function paletteEntries (scene) {
  const palette = scene.palette ?? {}
  return (
    (palette.color?.length ?? 0) +
    (palette.color_temperature?.length ?? 0) +
    (palette.dimming?.length ?? 0)
  )
}

function sceneSupportsDynamic (scene) {
  return scene.auto_dynamic || paletteEntries(scene) > 0
}

class Group extends Hue2Accessory {
  constructor (bridge, group, groupedLight, scenes = []) {
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
    this.sceneServicesById = {}
    this.dynamicSceneServicesById = {}
    this.primaryService = new Hue2Service.Light(this, groupedLight, {
      name: group.metadata?.name,
      primaryService: true
    })
    this.syncScenes(scenes)
    this.registerResourceDelegate(group, {
      update: (body) => {
        if (body.metadata?.name != null) {
          this.values.name = body.metadata.name
          this.primaryService.values.configuredName = body.metadata.name
          this.syncSceneServiceNames()
        }
      }
    })
    this.emit('initialised')
  }

  sceneName (scene, dynamic = false) {
    const sceneName = scene.metadata?.name ?? scene.id
    const name = `${this.values.name} ${sceneName}`
    return dynamic ? `${name} Dynamic` : name
  }

  syncSceneService (scene, dynamic = false) {
    const serviceById = dynamic
      ? this.dynamicSceneServicesById
      : this.sceneServicesById
    const name = this.sceneName(scene, dynamic)
    if (serviceById[scene.id] == null) {
      serviceById[scene.id] = new Hue2Service.Scene(this, scene, {
        action: dynamic ? 'dynamic_palette' : 'active',
        name,
        subtype: `${scene.type}.${scene.id}${dynamic ? '.dynamic' : ''}`
      })
    } else {
      serviceById[scene.id].update(scene)
      serviceById[scene.id].updateName(name)
    }
  }

  syncSceneServiceNames () {
    for (const service of Object.values(this.sceneServicesById)) {
      service.updateName(this.sceneName(service.resource))
    }
    for (const service of Object.values(this.dynamicSceneServicesById)) {
      service.updateName(this.sceneName(service.resource, true))
    }
  }

  syncScenes (scenes = []) {
    const activeScenes = new Set()
    const activeDynamicScenes = new Set()
    if (this.bridge.platform.config.scenes) {
      scenes.sort((a, b) => {
        const aName = a.metadata?.name ?? a.id
        const bName = b.metadata?.name ?? b.id
        return aName.localeCompare(bName)
      })
      for (const scene of scenes) {
        activeScenes.add(scene.id)
        this.syncSceneService(scene)
        if (sceneSupportsDynamic(scene)) {
          activeDynamicScenes.add(scene.id)
          this.syncSceneService(scene, true)
        }
      }
    }
    for (const [id, service] of Object.entries(this.sceneServicesById)) {
      if (!activeScenes.has(id)) {
        service.destroy()
        delete this.sceneServicesById[id]
      }
    }
    for (const [id, service] of Object.entries(this.dynamicSceneServicesById)) {
      if (!activeDynamicScenes.has(id)) {
        service.destroy()
        delete this.dynamicSceneServicesById[id]
      }
    }
  }
}

Hue2Accessory.Group = Group
