import fetch from 'node-fetch';
import { Home, HomelyLocation } from '../models/home';
import io from 'socket.io-client';
import { HomelySocket } from '../models/homely-socket';
import { authenticator } from './auth';
import { logger } from '../utils/logger';
import { retryWithBackoff, WS_RETRY } from '../utils/retry';
import config from 'config';
import { Config } from '../models/config';
import { HomelyDevice, HomelyFeature } from '../db';
import { publish } from '../entities/publish-entity-changes';
import { HomelyAlarmStateToHomeAssistant } from '../models/alarm-state';

const uri = `https://${config.get<Config['homely']['host']>(
  'homely.host'
)}/homely`;
const wsUri = `wss://${config.get<Config['homely']['host']>('homely.host')}`;

const CONNECT_TIMEOUT_MS = 20_000;

/**
 * Get all locations for the authenticated user.
 */
export async function locations(): Promise<Array<HomelyLocation>> {
  const token = await authenticator.getToken();
  const res = await fetch(`${uri}/locations`, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  });
  if (res.status >= 400) {
    const r = await res.text();
    throw new Error(r);
  }
  return await res.json();
}

/**
 * Get all details for a location, including devices & sensor states.
 * @param locationId
 */
export async function home(locationId: string): Promise<Home> {
  const token = await authenticator.getToken();
  const res = await fetch(`${uri}/home/${locationId}`, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
    },
  });
  if (res.status >= 400) {
    const err = await res.text();
    throw new Error(err);
  }
  return await res.json();
}

function attachEventHandlers(
  socket: SocketIOClient.Socket,
  locationId: string
) {
  socket.on('error', (err: unknown) => {
    logger.error({ err, locationId }, '[WS] transport error');
  });
  socket.on('disconnect', (reason: string) => {
    logger.warn({ reason, locationId }, '[WS] Disconnected from homely socket');
    scheduleReconnect(locationId);
  });
  socket.on('event', async function (data: HomelySocket) {
    logger.trace(data);
    logger.debug(`Got ${data.type} event from homely ws-api`);
    switch (data.type) {
      case 'device-state-changed':
        const unit = data.data;
        const device = await HomelyDevice.findOne({
          where: { id: unit.deviceId },
        });
        if (!device) {
          logger.warn(`Device not found: ${unit.deviceId}`);
          return;
        }
        logger.debug(`Device found: ${device.name}`);
        for (const c of unit.changes) {
          const feature = await HomelyFeature.findOne({
            where: { device_id_suffix: `${device.id}_${c.stateName}` },
          });
          if (!feature) {
            logger.warn(
              `[WS] Feature ${c.feature} -> ${c.stateName} (value=${JSON.stringify(c.value)}, lastUpdated=${c.lastUpdated}) not found for device: ${device.name}`
            );
            logger.debug(device);
            logger.debug(
              `Query by ${device.id}_${c.stateName} returned 0 results`
            );
            continue;
          }
          logger.info(`[WS] Updating state for ${feature.name} to ${c.value}`);
          const stateTopic = feature.state_topic;
          publish(stateTopic, c.value);
        }
        break;
      case 'alarm-state-changed':
        const gatewayDevice = await HomelyDevice.findOne({
          where: { modelId: 'Gateway', homeId: data.data.locationId },
          include: { all: true, nested: true },
        });
        if (!gatewayDevice) {
          logger.warn(
            `Gateway device not found for location ${data.data.locationId}`
          );
          return;
        }
        logger.debug(gatewayDevice.toJSON());
        if (!gatewayDevice.features) {
          logger.warn(`Gateway device has 0 features ${data.data.locationId}`);
          return;
        }
        const feature = gatewayDevice.features[0];
        if (!feature) {
          logger.warn(
            `Gateway feature not found for location ${data.data.locationId}`
          );
          return;
        }
        const stateTopic = feature.state_topic;
        const state = HomelyAlarmStateToHomeAssistant[data.data.state];
        publish(stateTopic, state);
        break;
      default:
        logger.warn(
          `Unknown event type ${
            (data as { type: string }).type
          }, see payload below:`
        );
        logger.warn(data);
    }
  });
}

/**
 * Opens a single websocket connection and resolves once it emits `connect`,
 * or rejects if it emits `connect_error` or exceeds the connect timeout.
 * Caller is responsible for retrying on rejection. Persistent event handlers
 * are attached before the connect handshake so early messages aren't dropped.
 */
async function connectOnce(locationId: string): Promise<void> {
  const token = await authenticator.getToken();
  const socket = io(
    `${wsUri}?locationId=${locationId}&token=Bearer ${token.access_token}`,
    {
      reconnection: false,
      transports: ['websocket'],
      autoConnect: true,
      timeout: CONNECT_TIMEOUT_MS,
      transportOptions: {
        polling: {
          extraHeaders: {
            Authorization: `Bearer ${token.access_token}`,
          },
        },
      },
    }
  );

  attachEventHandlers(socket, locationId);

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.close();
      reject(new Error(`[WS] connect timeout after ${CONNECT_TIMEOUT_MS}ms`));
    }, CONNECT_TIMEOUT_MS);

    socket.once('connect', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      logger.info(`[WS] Connected to homely for location ${locationId}`);
      resolve();
    });
    socket.once('connect_error', (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.close();
      reject(new Error(`[WS] connect_error: ${err}`));
    });
  });
}

const reconnectingByLocation = new Map<string, boolean>();

function scheduleReconnect(locationId: string) {
  if (reconnectingByLocation.get(locationId)) {
    logger.debug(`[WS] Reconnect already in progress for ${locationId}`);
    return;
  }
  reconnectingByLocation.set(locationId, true);
  logger.info(`[WS] Scheduling reconnect for ${locationId}`);
  retryWithBackoff(() => connectOnce(locationId), {
    ...WS_RETRY,
    label: `ws-reconnect:${locationId}`,
  })
    .catch((err) => {
      logger.error({ err, locationId }, '[WS] Reconnect gave up');
    })
    .finally(() => {
      reconnectingByLocation.set(locationId, false);
    });
}

/**
 * Listen to websocket events from homely updating the state of devices.
 * Retries the initial connection with exponential backoff until it succeeds.
 * @param locationId
 */
export async function listenToSocket(locationId: string) {
  await retryWithBackoff(() => connectOnce(locationId), {
    ...WS_RETRY,
    label: `ws-connect:${locationId}`,
  });
}
