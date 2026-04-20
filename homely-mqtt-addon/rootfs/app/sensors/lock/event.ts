import { Sensor } from '../model';
import { Feature } from '../../models/feature';

const sensor: Sensor<Feature<'report', 'event'>> = {
  path: 'report.states.event.value',
  format: 'string',
  type: 'sensor',
  name: 'lock_event',
  deviceSuffix: 'event',
  icon: 'mdi:history',
  entityCategory: 'diagnostic',
};

export { sensor };
