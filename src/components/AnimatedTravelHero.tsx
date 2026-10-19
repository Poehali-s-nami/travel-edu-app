"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { Mail, Phone } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GlobeMethods } from "react-globe.gl";
// Three 0.185 ships the runtime without TypeScript declarations.
// @ts-expect-error The imported constructors are used through their documented public API.
import { AmbientLight, Color, DirectionalLight, HemisphereLight, MeshPhongMaterial } from "three";

const Globe = dynamic(() => import("react-globe.gl"), { ssr: false });

const LAND_DATA_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson";

const stars = Array.from({ length: 64 }, (_, index) => ({
  left: `${(index * 37 + 7) % 100}%`,
  top: `${(index * 61 + 11) % 100}%`,
  size: index % 3 === 0 ? 2 : 1,
  peakOpacity: 0.62 + (index % 5) * 0.095,
  duration: 3.2 + (index % 7) * 0.55,
  delay: (index % 13) * 0.31
}));

const locationPins = [
  { lat: 51.17, lng: 71.43 },
  { lat: 41.01, lng: 28.98 },
  { lat: 25.2, lng: 55.27 },
  { lat: -8.41, lng: 115.19 },
  { lat: 40.71, lng: -74.01 },
  { lat: 51.51, lng: -0.13 },
  { lat: 35.68, lng: 139.69 },
  { lat: -33.87, lng: 151.21 },
  { lat: -22.91, lng: -43.17 },
  { lat: -33.93, lng: 18.42 }
];

type LandFeature = {
  type: "Feature";
  geometry: object;
  properties?: Record<string, unknown>;
};

export default function AnimatedTravelHero() {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const globeContainerRef = useRef<HTMLDivElement | null>(null);
  const [landPolygons, setLandPolygons] = useState<LandFeature[]>([]);
  const [globeSize, setGlobeSize] = useState(560);

  const globeMaterial = useMemo(
    () =>
      new MeshPhongMaterial({
        color: new Color("#123456"),
        specular: new Color("#79a9c8"),
        shininess: 32
      }),
    []
  );

  useEffect(() => {
    let active = true;

    fetch(LAND_DATA_URL)
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load land geometry");
        return response.json();
      })
      .then((data: { features?: LandFeature[] }) => {
        if (active) setLandPolygons(data.features ?? []);
      })
      .catch(() => {
        if (active) setLandPolygons([]);
      });

    return () => {
      active = false;
      globeMaterial.dispose();
    };
  }, [globeMaterial]);

  useEffect(() => {
    const container = globeContainerRef.current;
    if (!container) return;

    const updateSize = () => {
      const bounds = container.getBoundingClientRect();
      setGlobeSize(Math.max(280, Math.floor(Math.min(bounds.width, bounds.height))));
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  const configureGlobe = useCallback(() => {
    const globe = globeRef.current;
    if (!globe) return;

    const controls = globe.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.45;
    controls.enablePan = false;
    controls.enableZoom = false;

    const ambient = new AmbientLight(0xffffff, 1.75);
    const hemisphere = new HemisphereLight(0xdaf5ff, 0x0b182f, 1.25);
    const keyLight = new DirectionalLight(0xffffff, 0.55);
    keyLight.position.set(-2, 3, 4);

    globe.lights([ambient, hemisphere, keyLight]);
    globe.pointOfView({ lat: 14, lng: 15, altitude: 2.15 }, 0);
  }, []);

  const createLocationPin = useCallback(() => {
    const marker = document.createElement("div");
    marker.style.width = "20px";
    marker.style.height = "28px";
    marker.style.pointerEvents = "none";
    marker.style.filter = "drop-shadow(0 5px 5px rgba(11, 24, 47, 0.34))";

    const body = document.createElement("span");
    body.style.position = "absolute";
    body.style.left = "1px";
    body.style.top = "1px";
    body.style.width = "18px";
    body.style.height = "18px";
    body.style.background = "linear-gradient(145deg, #ff8c38, #F26522 65%)";
    body.style.border = "2px solid rgba(255,255,255,0.42)";
    body.style.borderRadius = "50% 50% 50% 0";
    body.style.transform = "rotate(-45deg)";
    body.style.boxShadow = "inset -2px -2px 4px rgba(132,47,0,0.2)";

    const center = document.createElement("span");
    center.style.position = "absolute";
    center.style.left = "7px";
    center.style.top = "7px";
    center.style.width = "6px";
    center.style.height = "6px";
    center.style.borderRadius = "999px";
    center.style.background = "#fff4e8";
    center.style.boxShadow = "0 1px 2px rgba(104,38,0,0.25)";

    marker.append(body, center);
    return marker;
  }, []);

  const updatePinVisibility = useCallback((element: HTMLElement, visible: boolean) => {
    element.style.opacity = visible ? "1" : "0";
    element.style.transition = "opacity 220ms ease";
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1 }}
      className="pointer-events-none relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-[#0b182f]"
    >
      <div className="absolute inset-0 bg-[#0b182f]" />

      <div className="pointer-events-none absolute inset-0 z-0">
        {stars.map((star, index) => (
          <motion.span
            key={index}
            className="pointer-events-none absolute rounded-full bg-white"
            style={{
              left: star.left,
              top: star.top,
              width: star.size,
              height: star.size
            }}
            animate={{ opacity: [0.3, star.peakOpacity, 0.3] }}
            transition={{
              repeat: Infinity,
              duration: star.duration,
              delay: star.delay,
              ease: "easeInOut"
            }}
          />
        ))}
      </div>

      <div className="relative z-10 flex aspect-square w-[90%] max-w-[900px] items-center justify-center">
        <div className="absolute left-1/2 top-1/2 z-0 h-[62%] w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/10 blur-3xl" />

        <div
          ref={globeContainerRef}
          className="absolute left-1/2 top-1/2 z-10 h-[70%] w-[70%] -translate-x-1/2 -translate-y-1/2 overflow-hidden opacity-95 drop-shadow-[0_0_45px_rgba(255,255,255,0.14)]"
        >
          <Globe
            ref={globeRef}
            width={globeSize}
            height={globeSize}
            globeImageUrl={null}
            bumpImageUrl={null}
            backgroundImageUrl={null}
            backgroundColor="rgba(0,0,0,0)"
            globeMaterial={globeMaterial}
            showAtmosphere
            atmosphereColor="#F26522"
            atmosphereAltitude={0.07}
            enablePointerInteraction={false}
            polygonsData={landPolygons}
            polygonGeoJsonGeometry="geometry"
            polygonCapColor={() => "#3b9428"}
            polygonSideColor={() => "#285f1d"}
            polygonStrokeColor={() => "rgba(156,255,126,0.42)"}
            polygonAltitude={0.01}
            polygonCapCurvatureResolution={4}
            polygonsTransitionDuration={0}
            htmlElementsData={locationPins}
            htmlElement={createLocationPin}
            htmlElementVisibilityModifier={updatePinVisibility}
            onGlobeReady={configureGlobe}
          />
        </div>

        <motion.img
          src="/plane.png"
          alt=""
          className="absolute left-[10%] top-[10%] z-20 w-[40%]"
          animate={{ y: [0, -14, 0], rotate: [-4, 4, -4] }}
          transition={{ repeat: Infinity, duration: 5.5, ease: "easeInOut" }}
        />

        <motion.img
          src="/suitcase.png"
          alt=""
          className="absolute right-[10%] top-[35%] z-20 w-[15%] rotate-[10deg]"
          animate={{ y: [0, 14, 0], rotate: [10, 14, 10] }}
          transition={{ repeat: Infinity, duration: 6, ease: "easeInOut", delay: 0.5 }}
        />

        <motion.div
          className="absolute bottom-[18%] left-[12%] z-20 w-[18%]"
          animate={{ y: [0, -10, 0] }}
          transition={{ repeat: Infinity, duration: 4, ease: "easeInOut", delay: 1 }}
        >
          <img src="/binoculars.png" alt="" className="block w-full -scale-x-100" />
        </motion.div>

        <motion.img
          src="/map.png"
          alt=""
          className="absolute bottom-[14%] right-[13%] z-20 w-[20%]"
          animate={{ y: [0, 10, 0], rotate: [0, 10, 0] }}
          transition={{ repeat: Infinity, duration: 5, ease: "easeInOut", delay: 1.5 }}
        />
      </div>

      <div className="absolute bottom-10 z-20 flex flex-col items-center gap-2 text-sm font-light tracking-wide text-white/50 [font-family:'Lato',Arial,sans-serif]">
        <p>Администратор системы</p>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Phone size={14} />
            <span>+7 708 491 4880</span>
          </div>
          <div className="flex items-center gap-2">
            <Mail size={14} />
            <span>psnkzeducation@gmail.com</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
