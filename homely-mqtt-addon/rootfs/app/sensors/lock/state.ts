import { Sensor } from '../model';
import { Feature } from '../../models/feature';

const sensor: Sensor<Feature<'lock', 'state'>> = {
  path: 'lock.states.state.value',
  format: 'boolean',
  type: 'binary_sensor',
  name: 'lock',
  deviceSuffix: 'state',
  icon: 'mdi:lock',
};

export { sensor };
