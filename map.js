L.CRS.SeatGeek = L.extend({}, L.CRS, {
  projection: L.Projection.LonLat,
	transformation: new L.Transformation(0.35, 0, 0.35, 0),

	scale: function (zoom) {
		return Math.pow(2, zoom);
	}
});

var map = L.map("map", {
  minZoom: 1,
  maxZoom: 4,
  crs: L.CRS.SeatGeek
}).setView([500, 500], 1);

L.tileLayer('http://{s}.tiles.seatgeek.com/v3/maps/{mapId}/{z}/{x}/{y}.png', {
  mapId: "v1-1-5",
  tileSize: 350,
  minZoom: 1,
  maxZoom: 4,
  continuousWorld: true,
  noWrap: true
}).addTo(map);

L.SG3DLayer = L.Class.extend({

    map: null,
    container: null,
    data: null,

    // I don't *think* it matters what we pick here
    vFOV: 60,
    // Distance of camera from plane of the scene
    cameraHeight: 1000,
    threeOrigin: null,
    // At what coordinates was the sceneOrigin when we first layed everything out
    initialSceneOriginLatLng: null,
    heightScale: null,

    initialize: function (options) {
        options = L.Util.setOptions(this, options);

        this.data = [];

      	this.material = new THREE.MeshLambertMaterial({
          color: 0xffffff,
          shading: THREE.FlatShading,
          opacity: 0.8,
          overdraw: false,
          wireframe: false
        });
    },

    _move: function () {

    },

    _initScene: function () {
    	this.camera = new THREE.PerspectiveCamera(this.vFOV, this.map._size.x / this.map._size.y, 1, 1000);
    	this.camera.position.x = 0;
    	this.camera.position.y = 0;
    	this.camera.position.z = this.cameraHeight;

    	this.scene = new THREE.Scene();

    	// Lights

    	var ambientLight = new THREE.AmbientLight(0x8d8d8d);
    	this.scene.add(ambientLight);

      this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.65);
      this.directionalLight.position.x = - 0.5;
      this.directionalLight.position.y = - 0.5;
      this.directionalLight.position.z = 0.6;
      this.scene.add(this.directionalLight);

    	this.renderer = new THREE.CanvasRenderer();

      this._el = L.DomUtil.create('div', 'sg-3d-layer leaflet-zoom-hide');
      this._el.appendChild(this.renderer.domElement);
      this.map.getPanes().overlayPane.appendChild(this._el);
    },

    _resetScene: function () {
      var that = this;

      this.camera.aspect = this.map._size.x / this.map._size.y;
      this.camera.updateProjectionMatrix();
    	this.renderer.setSize(this.map._size.x, this.map._size.y);

      // Helpers
      function degToRad (angle) { return angle * Math.PI / 180; }
      function radToDeg (angle) { return angle * 180 / Math.PI; }

      // How many vertical scene units can we see? (https://github.com/mrdoob/three.js/issues/1239)
      // Useful diagram: http://techpubs.sgi.com/library/dynaweb_docs/0650/SGI_Developer/books/Perf_PG/sgi_html/figures/04.3.frustum.gif
      var visibleHeight = 2 * Math.tan(degToRad(this.vFOV) / 2) * this.cameraHeight;

      var scale = that.map._size.y / visibleHeight;

      this.threeOrigin = new L.Point(this.map._size.x / 2, this.map._size.y / 2);

      // ScenePoint: x,y coord in the THREE scene
      // LatLng: x,y coord in the reference system
      // containerPoint: x,y coord on the screen

      this.latLngToScenePoint = function latLngToScenePoint (latLng) {
        var containerPoint = that.map.latLngToContainerPoint(latLng);
        return new L.Point(
          (containerPoint.x - that.threeOrigin.x) * (1 / scale),
          // Need to flip the y-axis
          -1 * (containerPoint.y - that.threeOrigin.y) * (1 / scale)
        );
      }

      var degreesLatVisible = this.map.containerPointToLatLng([0, this.map._size.y]).lat -
                                this.map.containerPointToLatLng([0, 0]).lat;
      this.heightScale = degreesLatVisible / visibleHeight;

      this._drawObjects();
      this._animateInObjects();
    },

    _startRenderLoop: function () {
      var that = this;

      var stats = new Stats();
      stats.domElement.style.cssText = 'position: absolute; top: 0px; right: 0px';
      document.body.appendChild(stats.domElement);

      var lastPos = null
      function render() {
      	requestAnimationFrame(render);

        TWEEN.update();

        var scenePoint = that.latLngToScenePoint(that.initialSceneOriginLatLng);
        that.group.position.x = scenePoint.x;
        that.group.position.y = scenePoint.y;
    	  that.renderer.render(that.scene, that.camera);

        var curPos = that.map.containerPointToLayerPoint([0, 0]);
        if (lastPos === null || !(lastPos.x === curPos.x && lastPos.y === curPos.x)) {
          L.DomUtil.setPosition(that._el, lastPos = curPos);
        }

        stats.update();
      }
      render();
    },

    addTo: function (map) {
        map.addLayer(this);
        return this;
    },

    onAdd: function (map) {
        var that = this;

        this.map = map;

        if (this.renderer) {
            // TODO: re-adding behavior
        } else {
            this._initScene();
            this._resetScene();
            this._startRenderLoop();
        }

        this.map.on({
          move: this._move,
          viewreset: this._resetScene
        }, this);
        window.addEventListener('resize', function () { that._resetScene(); }, false);
    },

    _geoJSONGeometryToShape: function (geometry) {
      if (geometry.type !== "Polygon") {
        throw "Only Polygons are currently supported";
      }
      var vertices = geometry.coordinates[0];
      var pts = [];
      for (var i = 0; i < vertices.length; ++i) {
        var ppt = this.latLngToScenePoint(L.latLng(vertices[i][1], vertices[i][0]), 1)
        pts.push(new THREE.Vector2(ppt.x, ppt.y));
      }
      var shape = new THREE.Shape();
      shape.fromPoints(pts);
      return shape;
    },

    _drawObjects: function () {
      if (this.group) {
        this.scene.remove(this.group);
      }

      this.group = new THREE.Object3D();

      
      var building, geometry;
      for (var i = 0; i < this.data.length; ++i) {
        building = this.data[i];
        geometry = this._geoJSONGeometryToShape(building.geometry)
          .extrude({
            amount: building.properties.height / (this.heightScale*2),
            bevelEnabled: false
          });
        this.group.add(new THREE.Mesh(geometry, this.material));
      }

      this.scene.add(this.group)

      var sceneOrigin = new L.Point(this.map._size.x / 2, this.map._size.y / 2);
      this.initialSceneOriginLatLng = this.map.containerPointToLatLng(sceneOrigin);
    },

    _animateInObjects: function () {
      var that = this;
      var tween = new TWEEN.Tween({ z: 0.001 })
        .to({ z: 1 }, 600)
        .easing(TWEEN.Easing.Cubic.Out)
        .onUpdate(function () {
          that.group.scale.z = this.z;
        })
        .start();
    },

    _initStats: function () {
    	var container = document.createElement('div');
    	document.body.appendChild(container);
      this.stats = new Stats();
      this.stats.domElement.style.position = 'absolute';
      this.stats.domElement.style.top = '0px';
      container.appendChild(this.stats.domElement);
    },

    onRemove: function (map) {
      this.map = null;
      map.off({
        move: this._move,
        viewreset: this._resetScene
      }, this);
      this.container.parentNode.removeChild(this.container);
    },

    geoJSON: function (x) {
      this.data = x;
      this._resetScene();
      this._animateInObjects();
    }
});

var sg3DLayer = new L.SG3DLayer().addTo(map);

setTimeout(function () {
  $.get("citi-field.geo.json", function (data) {
    sg3DLayer.geoJSON(data.features);
  });  
}, 500);
