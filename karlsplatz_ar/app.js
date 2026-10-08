(function () {
  'use strict';

  //<!-- 48.210419, 16.333352 GST 48.210317, 16.333923 -->
  var TARGET = {
    latitude: 48.19723595366788,
    longitude: 16.370189972865745
  };

  function getQueryValue(params, names) {
    for (var i = 0; i < names.length; i += 1) {
      if (params.has(names[i])) {
        return params.get(names[i]);
      }
    }

    return null;
  }

  function parseCoordinate(value) {
    var parsed;

    if (value === null || value === '') {
      return NaN;
    }

    parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function getFakeGpsTarget() {
    var params = new URLSearchParams(window.location.search);
    var fakeGps = getQueryValue(params, [
      'fakegps',
      'fakeGps',
      'fakeGPS',
      'simulateGps',
      'simulateGPS'
    ]);
    var latitude;
    var longitude;

    if (fakeGps === null) {
      return null;
    }

    latitude = parseCoordinate(getQueryValue(params, ['lat', 'latitude']));
    longitude = parseCoordinate(getQueryValue(params, ['lon', 'lng', 'longitude']));

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      latitude = TARGET.latitude;
      longitude = TARGET.longitude;
    }

    return {
      latitude: latitude,
      longitude: longitude
    };
  }

  function wildcardToRegExp(pattern) {
    var escaped = pattern.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
    return new RegExp('^' + escaped.replace(/\\\*/g, '.*') + '$');
  }

  AFRAME.registerComponent('gltf-animation-player', {
    schema: {
      clip: { default: '*' },
      loop: { default: 'repeat', oneOf: ['once', 'repeat', 'pingpong'] },
      repetitions: { type: 'int', default: 0 },
      timeScale: { type: 'number', default: 1 },
      crossFadeDuration: { type: 'number', default: 0 },
      clampWhenFinished: { type: 'boolean', default: false }
    },

    init: function () {
      this.mixer = null;
      this.model = null;
      this.actions = [];
      this.loopMap = {
        once: THREE.LoopOnce,
        repeat: THREE.LoopRepeat,
        pingpong: THREE.LoopPingPong
      };
      this.onModelLoaded = this.onModelLoaded.bind(this);

      this.el.addEventListener('model-loaded', this.onModelLoaded);

      var model = this.el.getObject3D('mesh');
      if (model) {
        this.load(model);
      }
    },

    onModelLoaded: function (event) {
      this.load(event.detail.model);
    },

    load: function (model) {
      this.stopActions();
      this.model = model;
      this.mixer = new THREE.AnimationMixer(model);
      this.playActions();
    },

    update: function () {
      if (!this.mixer || !this.model) {
        return;
      }

      this.stopActions();
      this.playActions();
    },

    tick: function (time, deltaTime) {
      if (!this.mixer || !Number.isFinite(deltaTime)) {
        return;
      }

      this.mixer.update((deltaTime / 1000) * this.data.timeScale);
    },

    playActions: function () {
      var animations = this.model.animations || [];
      var matcher = wildcardToRegExp(this.data.clip || '*');
      var repetitions = this.data.repetitions > 0 ? this.data.repetitions : Infinity;
      var loopMode = this.loopMap[this.data.loop] || THREE.LoopRepeat;

      for (var i = 0; i < animations.length; i += 1) {
        var clip = animations[i];
        if (!matcher.test(clip.name)) {
          continue;
        }

        var action = this.mixer.clipAction(clip, this.model);
        action.enabled = true;
        action.clampWhenFinished = this.data.clampWhenFinished;
        action.setLoop(loopMode, repetitions);

        if (this.data.crossFadeDuration > 0) {
          action.fadeIn(this.data.crossFadeDuration);
        }

        action.play();
        this.actions.push(action);
      }
    },

    stopActions: function () {
      if (!this.actions) {
        return;
      }

      for (var i = 0; i < this.actions.length; i += 1) {
        if (this.data && this.data.crossFadeDuration > 0) {
          this.actions[i].fadeOut(this.data.crossFadeDuration);
        } else {
          this.actions[i].stop();
        }
      }

      this.actions.length = 0;
    },

    remove: function () {
      this.stopActions();
      if (this.mixer) {
        this.mixer.stopAllAction();
      }
      this.el.removeEventListener('model-loaded', this.onModelLoaded);
    }
  });

  AFRAME.registerComponent('face-camera-y', {
    schema: {
      enabled: { type: 'boolean', default: true }
    },

    init: function () {
      this.cameraPosition = new THREE.Vector3();
      this.objectPosition = new THREE.Vector3();
    },

    tick: function () {
      var camera = this.el.sceneEl && this.el.sceneEl.camera;
      if (!this.data.enabled || !camera) {
        return;
      }

      camera.getWorldPosition(this.cameraPosition);
      this.el.object3D.getWorldPosition(this.objectPosition);

      var dx = this.cameraPosition.x - this.objectPosition.x;
      var dz = this.cameraPosition.z - this.objectPosition.z;

      if (Math.abs(dx) + Math.abs(dz) < 0.001) {
        return;
      }

      this.el.object3D.rotation.y = Math.atan2(dx, dz);
    }
  });

  AFRAME.registerComponent('orientation-smoothing', {
    schema: {
      factor: { type: 'number', default: 0.25 }
    },

    init: function () {
      this.apply = this.apply.bind(this);
      this.onComponentInitialized = this.onComponentInitialized.bind(this);
      this.el.addEventListener('componentinitialized', this.onComponentInitialized);
      this.el.addEventListener('loaded', this.apply);
      window.setTimeout(this.apply, 500);
    },

    onComponentInitialized: function (event) {
      if (event.detail.name === 'arjs-device-orientation-controls') {
        this.apply();
      }
    },

    apply: function () {
      if (!this.el.components['arjs-device-orientation-controls']) {
        return;
      }

      this.el.setAttribute('arjs-device-orientation-controls', 'smoothingFactor', this.data.factor);
    },

    remove: function () {
      this.el.removeEventListener('componentinitialized', this.onComponentInitialized);
      this.el.removeEventListener('loaded', this.apply);
    }
  });

  AFRAME.registerComponent('deferred-gps-new-entity-place', {
    schema: {
      longitude: { type: 'number', default: 0 },
      latitude: { type: 'number', default: 0 }
    },

    init: function () {
      this.cameraEl = null;
      this.cameraGps = null;
      this.retryTimer = null;
      this.onGpsUpdate = this.onGpsUpdate.bind(this);
      this.bindCamera = this.bindCamera.bind(this);
      this.el.object3D.visible = false;
      this.bindCamera();
    },

    update: function () {
      this.updateWorldPosition();
    },

    bindCamera: function () {
      var cameraEl = document.querySelector('[gps-new-camera]');
      var cameraGps = cameraEl && cameraEl.components && cameraEl.components['gps-new-camera'];

      if (!cameraGps) {
        this.retryTimer = window.setTimeout(this.bindCamera, 100);
        return;
      }

      this.cameraEl = cameraEl;
      this.cameraGps = cameraGps;
      this.cameraEl.addEventListener('gps-camera-update-position', this.onGpsUpdate);
      this.updateWorldPosition();
    },

    onGpsUpdate: function (event) {
      var position = event.detail && event.detail.position;

      this.updateWorldPosition();

      if (position) {
        this.setDistanceFrom(position);
      }
    },

    updateWorldPosition: function () {
      var worldPosition;

      if (!this.cameraGps || !this.cameraGps.getInitialPosition()) {
        return;
      }

      worldPosition = this.cameraGps.latLonToWorld(this.data.latitude, this.data.longitude);
      this.el.object3D.position.x = worldPosition[0];
      this.el.object3D.position.z = worldPosition[1];
      this.el.object3D.visible = true;
    },

    setDistanceFrom: function (position) {
      var distance = haversineMeters(position, this.data);

      this.el.setAttribute('distance', distance);
      this.el.setAttribute('distanceMsg', formatDistance(distance));
      this.el.emit('gps-entity-place-update-position', {
        distance: distance
      });
    },

    remove: function () {
      if (this.retryTimer) {
        window.clearTimeout(this.retryTimer);
      }

      if (this.cameraEl) {
        this.cameraEl.removeEventListener('gps-camera-update-position', this.onGpsUpdate);
      }
    }
  });

  AFRAME.registerComponent('url-gps-simulator', {
    init: function () {
      this.target = null;
      this.retryTimer = null;
      this.applySimulation = this.applySimulation.bind(this);
      this.forceGpsPosition = this.forceGpsPosition.bind(this);
      this.applySimulation();
      window.setTimeout(this.applySimulation, 250);
      window.setTimeout(this.forceGpsPosition, 1000);
    },

    applySimulation: function () {
      var target = getFakeGpsTarget();
      var currentGpsSettings;

      if (!target) {
        return;
      }

      this.target = target;
      currentGpsSettings = this.el.getAttribute('gps-new-camera') || {};
      this.el.setAttribute('gps-new-camera', {
        gpsMinDistance: currentGpsSettings.gpsMinDistance,
        positionMinAccuracy: currentGpsSettings.positionMinAccuracy,
        gpsTimeInterval: currentGpsSettings.gpsTimeInterval,
        initialPositionAsOrigin: currentGpsSettings.initialPositionAsOrigin,
        simulateLatitude: target.latitude,
        simulateLongitude: target.longitude
      });
      this.forceGpsPosition();
    },

    forceGpsPosition: function () {
      var target = this.target || getFakeGpsTarget();
      var gps = this.el.components && this.el.components['gps-new-camera'];

      if (!target) {
        return;
      }

      this.target = target;

      if (!gps || !gps.threeLoc) {
        this.retryTimer = window.setTimeout(this.forceGpsPosition, 100);
        return;
      }

      gps.threeLoc.stopGps();
      gps.threeLoc.fakeGps(target.longitude, target.latitude);
      gps._currentPosition = {
        latitude: target.latitude,
        longitude: target.longitude
      };

      if (typeof gps._sendGpsUpdateEvent === 'function') {
        gps._sendGpsUpdateEvent(target.longitude, target.latitude);
      } else {
        this.el.emit('gps-camera-update-position', {
          position: gps._currentPosition
        });
      }
    },

    remove: function () {
      if (this.retryTimer) {
        window.clearTimeout(this.retryTimer);
      }
    }
  });

  function normalizeCoords(coords) {
    var normalized = {
      latitude: Number(coords && (coords.latitude !== undefined ? coords.latitude : coords.lat)),
      longitude: Number(coords && (coords.longitude !== undefined ? coords.longitude : coords.lon))
    };
    var normalDistance;
    var swappedDistance;

    if (!Number.isFinite(normalized.latitude) || !Number.isFinite(normalized.longitude)) {
      return null;
    }

    normalDistance = Math.abs(normalized.latitude - TARGET.latitude) +
      Math.abs(normalized.longitude - TARGET.longitude);
    swappedDistance = Math.abs(normalized.longitude - TARGET.latitude) +
      Math.abs(normalized.latitude - TARGET.longitude);

    if (swappedDistance < normalDistance) {
      return {
        latitude: normalized.longitude,
        longitude: normalized.latitude
      };
    }

    return normalized;
  }

  function degToRad(degrees) {
    return degrees * Math.PI / 180;
  }

  function haversineMeters(from, to) {
    from = normalizeCoords(from);
    to = normalizeCoords(to);

    if (!from || !to) {
      return NaN;
    }

    var radius = 6371000;
    var lat1 = degToRad(from.latitude);
    var lat2 = degToRad(to.latitude);
    var dLat = degToRad(to.latitude - from.latitude);
    var dLon = degToRad(to.longitude - from.longitude);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

    return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) {
      return '';
    }

    if (meters >= 1000) {
      return (meters / 1000).toFixed(1) + ' km';
    }

    return Math.max(0, Math.round(meters)) + ' m';
  }

  function compactText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function errorMessageFrom(reason) {
    if (!reason) {
      return '';
    }

    if (typeof reason === 'string') {
      return compactText(reason);
    }

    if (reason.message) {
      return compactText(reason.message);
    }

    if (reason.name) {
      return compactText(reason.name);
    }

    try {
      return compactText(String(reason));
    } catch (error) {
      return '';
    }
  }

  function initStatusOverlay() {
    var status = document.getElementById('ar-status');
    var statusText = status && status.querySelector('[data-ar-status-text]');
    var camera = document.getElementById('ar-camera');
    var scene = document.querySelector('a-scene');
    var hasBlockingStartupError = false;
    var lastErrorPopupText = '';

    if (!status || !statusText || !camera || !scene) {
      return;
    }

    function setStatus(message, state) {
      if (hasBlockingStartupError && state !== 'error') {
        return;
      }

      statusText.textContent = message;
      status.classList.toggle('is-ready', state === 'ready');
      status.classList.toggle('is-error', state === 'error');
    }

    function setError(message, detail, blocking) {
      var text = message;

      if (detail) {
        text += ': ' + detail;
      }

      hasBlockingStartupError = hasBlockingStartupError || Boolean(blocking);
      setStatus(text, 'error');
    }

    function getCameraPosition() {
      var gps = camera.components && camera.components['gps-new-camera'];

      return gps && gps._currentPosition ? gps._currentPosition : null;
    }

    function showCurrentGpsState() {
      var position = getCameraPosition();
      var distance;

      if (!position) {
        return false;
      }

      distance = haversineMeters(position, TARGET);
      setStatus('GPS aktiv, Storch in ' + formatDistance(distance), 'ready');
      return true;
    }

    function showStartupContextProblems() {
      if (window.location.protocol === 'file:') {
        setError(
          'Bitte ueber lokalen Server oeffnen',
          'Chrome kann Kamera/GPS nicht direkt aus einer Datei starten.',
          true
        );
        return;
      }

      if (!window.isSecureContext) {
        setError(
          'Bitte ueber HTTPS oeffnen',
          'Chrome blockiert Kamera, GPS und Bewegungsdaten ueber HTTP.',
          true
        );
        return;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError(
          'Kamera-API nicht verfuegbar',
          'Bitte HTTPS und einen aktuellen mobilen Browser verwenden.',
          true
        );
        return;
      }

      if (!navigator.geolocation) {
        setError(
          'GPS-API nicht verfuegbar',
          'Bitte Standortdienste im Browser und am Telefon pruefen.',
          true
        );
      }
    }

    function mirrorArjsErrorPopup() {
      var popup = document.getElementById('error-popup');
      var popupText = popup && compactText(popup.textContent || popup.innerText);

      if (!popupText || popupText === lastErrorPopupText) {
        return;
      }

      lastErrorPopupText = popupText;
      setError('Kamera konnte nicht gestartet werden', popupText, true);
    }

    showStartupContextProblems();
    window.setInterval(mirrorArjsErrorPopup, 500);

    scene.addEventListener('loaded', function () {
      if (!showCurrentGpsState()) {
        setStatus('Kamera aktiv, warte auf GPS...', 'waiting');
      }
    });

    window.setTimeout(showCurrentGpsState, 250);
    window.setTimeout(showCurrentGpsState, 1000);

    camera.addEventListener('gps-camera-update-position', function (event) {
      var position = event.detail && event.detail.position;
      if (!position) {
        return;
      }

      var distance = haversineMeters(position, TARGET);
      setStatus('GPS aktiv, Storch in ' + formatDistance(distance), 'ready');
    });

    window.addEventListener('error', function (event) {
      var detail = event && (event.message || errorMessageFrom(event.error));
      setError('AR konnte nicht vollstaendig gestartet werden', detail, true);
    });

    window.addEventListener('unhandledrejection', function (event) {
      setError(
        'AR konnte nicht vollstaendig gestartet werden',
        errorMessageFrom(event && event.reason),
        true
      );
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStatusOverlay);
  } else {
    initStatusOverlay();
  }
}());
