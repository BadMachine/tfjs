/**
 * @license
 * Copyright 2021 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import * as tf from '@tensorflow/tfjs-core';

import {TFLiteModel} from './tflite_model';
import {TFWebModelRunner, TFWebModelRunnerOptions, TFWebModelRunnerTensorInfo} from './types/tfweb_model_runner';

// A mock TFWebModelRunner that doubles the data from input tensors to output
// tensors during inference.
class MockModelRunner implements TFWebModelRunner {
  private mockInferResults: string[] = [];

  private inputTensors = this.getTensorInfos();
  private outputTensors = this.getTensorInfos();

  singleOutput = false;

  constructor(modelPath: string, options: TFWebModelRunnerOptions) {
    this.mockInferResults.push(`ModelPath=${modelPath}`);
    this.mockInferResults.push(`numThreads=${options.numThreads}`);
  }

  getInputs(): TFWebModelRunnerTensorInfo[] {
    return this.inputTensors;
  }

  getOutputs(): TFWebModelRunnerTensorInfo[] {
    return this.singleOutput ? [this.outputTensors[0]] : this.outputTensors;
  }

  infer(): boolean {
    for (let i = 0; i < this.inputTensors.length; i++) {
      const inputTensor = this.inputTensors[i];
      const outputTensor = this.outputTensors[i];
      outputTensor.data().set(Array.from(inputTensor.data()).map(v => v * 2));
    }
    return true;
  }

  cleanUp() {}

  private getTensorInfos(): TFWebModelRunnerTensorInfo[] {
    const shape0 = [1, 2, 3];
    const buffer0 = new Int32Array(shape0.reduce((a, c) => a * c, 1));
    const shape1 = [1, 2];
    const buffer1 = new Int32Array(shape1.reduce((a, c) => a * c, 1));
    return [
      {
        id: 0,
        dataType: 'int32',
        name: 't0',
        shape: shape0.join(','),
        data: () => buffer0,
      },
      {
        id: 1,
        dataType: 'float32',
        name: 't1',
        shape: shape1.join(','),
        data: () => buffer1,
      },
    ];
  }
}

let tfliteModel: TFLiteModel;
let modelRunner: MockModelRunner;

describe('TFLiteModel', () => {
  beforeEach(() => {
    modelRunner = new MockModelRunner('my_model.tflite', {numThreads: 2});
    tfliteModel = new TFLiteModel(modelRunner);
  });

  it('should generate the output for single tensor', () => {
    const input = tf.tensor3d([1, 2, 3, 4, 5, 6], [1, 2, 3], 'int32');
    const outputs = tfliteModel.predict(input, {}) as tf.Tensor[];
    tf.test_util.expectArraysClose(outputs[0].dataSync(), [2, 4, 6, 8, 10, 12]);
  });

  it('should generate the output for tensor array', () => {
    const input0 = tf.tensor3d([1, 2, 3, 4, 5, 6], [1, 2, 3], 'int32');
    const input1 = tf.tensor2d([11, 12], [1, 2], 'float32');
    const outputs = tfliteModel.predict([input0, input1], {}) as tf.Tensor[];
    tf.test_util.expectArraysClose(outputs[0].dataSync(), [2, 4, 6, 8, 10, 12]);
    tf.test_util.expectArraysClose(outputs[1].dataSync(), [22, 24]);
  });

  it('should generate the output for tensor map', () => {
    const input0 = tf.tensor3d([1, 2, 3, 4, 5, 6], [1, 2, 3], 'int32');
    const input1 = tf.tensor2d([11, 12], [1, 2], 'float32');
    const outputs =
        tfliteModel.predict({'t0': input0, 't1': input1}, {}) as tf.Tensor[];
    tf.test_util.expectArraysClose(outputs[0].dataSync(), [2, 4, 6, 8, 10, 12]);
    tf.test_util.expectArraysClose(outputs[1].dataSync(), [22, 24]);
  });

  it('should generate a single output when model has a single output', () => {
    modelRunner.singleOutput = true;

    const input = tf.tensor3d([1, 2, 3, 4, 5, 6], [1, 2, 3], 'int32');
    const outputs = tfliteModel.predict(input, {}) as tf.Tensor[];
    expect(outputs instanceof tf.Tensor).toBe(true);
  });

  it('should throw error if input size mismatcht', () => {
    // Mismatch: 1 vs 2.
    const input0 = tf.tensor3d([1, 2, 3, 4, 5, 6], [1, 2, 3], 'int32');
    expect(() => tfliteModel.predict([input0], {})).toThrow();
  });

  it('should throw error if input shape mismatcht', () => {
    // Mismatch: [2,2] vs [1,2,3].
    const input0 = tf.tensor2d([1, 2, 3, 4], [2, 2], 'int32');
    const input1 = tf.tensor2d([11, 12], [1, 2], 'float32');
    expect(() => tfliteModel.predict([input0, input1], {})).toThrow();
  });

  it('should throw error if input type is not compatible', () => {
    // Mismatch: float32 -> int32
    const input0 = tf.tensor2d([1, 2, 3, 4], [2, 2], 'float32');
    const input1 = tf.tensor2d([11, 12], [1, 2], 'float32');
    expect(() => tfliteModel.predict([input0, input1], {})).toThrow();
  });
});