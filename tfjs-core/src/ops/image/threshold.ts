/**
 * @license
 * Copyright 2021 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import { Tensor1D, Tensor3D } from '../../tensor';
import { tensor1d } from '../tensor1d';
import { TensorLike } from '../../types';
import { op } from '../operation';
import { cast } from '../cast';
import { split } from '../split';
import { bincount } from '../bincount';
import { lessEqual } from '../less_equal';
import { greater } from '../greater';
import { sum } from '../sum';
import { add } from '../add';
import { mul } from '../mul';
import { div } from '../div';
import { sub } from '../sub';
import {atan} from '../atan';
import {tan} from '../tan';
import {slice} from '../slice';
import {argMax} from '../arg_max';
import {max} from '../max';
import {argMin} from '../arg_min';
import {less} from '../less';
import { round } from '../round';
import { where } from '../where';
import {reshape} from '../reshape';
import {sqrt} from '../sqrt';
import {pow} from '../pow';
import {abs} from '../abs';
import {gatherND} from '../gather_nd';
import {clone} from '../clone';
import {reverse} from '../reverse';
import {zerosLike} from '../zeros_like';
import { fill } from '../fill';
import { range } from '../range';
import { tensor } from '../tensor';
import * as util from '../../util';
import { convertToTensor } from '../../tensor_util_env';

/**
 * Performs image binarization with corresponding threshold
 * (depends on the method)value, which creates a binary image from a grayscale.
 * @param image 3d tensor of shape [imageHeight,imageWidth, depth],
 * where imageHeight and imageWidth must be positive.The image color
 * range should be [0, 255].
 * @param method Optional string from `'binary' | 'otsu' | 'triangle'`
 * which specifies the method for thresholding. Defaults to 'binary'.
 * @param inverted Optional boolean whichspecifies
 * if colours should be inverted. Defaults to false.
 * @param threshValue Optional number which defines threshold value from 0 to 1.
 * Defaults to 0.5.
 * @return A 3d tensor of shape [imageHeight,imageWidth, depth], which
 * contains binarized image.
 */

function threshold_(
    image: Tensor3D | TensorLike,
    method = 'binary',
    inverted = false,
    threshValue = 0.5
): Tensor3D {
    const $image = convertToTensor(image, 'image', 'threshold');

    /* 0.2989, 0.5870, 0.1140 are represent luma coefficients in CCIR601.
	Reference for converting between RGB and grayscale: https://en.wikipedia.org/wiki/Luma_%28video%29  */

    const RED_INTENCITY_COEF = 0.2989;
    const GREEN_INTENCITY_COEF = 0.5870;
    const BLUE_INTENCITY_COEF = 0.1140;
    const totalPixelsInImage = $image.shape[0] * $image.shape[1];

    let $threshold = mul(tensor1d([threshValue]), 255);
    let r, g, b, grayscale;

    util.assert(
        $image.rank === 3,
        () => 'Error in threshold: image must be rank 3,' +
            `but got rank ${$image.rank}.`);

    util.assert(
        $image.shape[2] === 3 || $image.shape[2]=== 1,
        () => 'Error in threshold: ' +
            'image color channel must be equal to 3 or 1' +
            `but got ${$image.shape[2]}.`);

    util.assert(
      $image.dtype === 'int32' || $image.dtype === 'float32',
      () => 'Error in dtype: image dtype must be int32 or float32,' +
          `but got dtype ${$image.dtype}.`);

    util.assert(
      method === 'otsu' || method === 'binary',
      () => `Method must be binary or otsu, but was ${method}`);

    if ($image.shape[2] === 3) {
        [r, g, b] = split($image, [1, 1, 1], -1);
        const $r = mul(r,RED_INTENCITY_COEF);
        const $g = mul(g,GREEN_INTENCITY_COEF);
        const $b = mul(b,BLUE_INTENCITY_COEF);
        grayscale = add(add($r, $g), $b);
    } else {
        grayscale = image;
    }

    if (method === 'otsu') {
        const $histogram = bincount(cast(round(grayscale), 'int32') as Tensor1D,
            tensor([]),
            256);
        $threshold = otsu($histogram, totalPixelsInImage);
    }
    else if(method === 'triangle'){
        const $histogram = bincount(cast(round(grayscale), 'int32') as Tensor1D,
            tensor([]),
            256);
        $threshold = triangle($histogram);
    }

    const invCondition = inverted ?
        lessEqual(grayscale, $threshold) : greater(grayscale, $threshold);

    const result = cast(mul(invCondition,255), 'int32');

    return result as Tensor3D;
}

function otsu(histogram: Tensor1D, total: number):Tensor1D {

    let bestThresh = tensor1d([-1]);
    let bestInBetVar = tensor1d([0]);
    let cInBetVar = tensor1d([0]);
    let classFirst, classSecond, meanFirst,
        meanSec, weightForeground, weightBack;

    for (let index = 0; index < histogram.size-1; index++) {

        classFirst = slice(histogram, 0, index + 1);

        classSecond = slice(histogram,index + 1);

        weightForeground = div(sum(classFirst),total);

        weightBack = div(sum(classSecond),total);

        const meanFirstDivA = sum(mul(classFirst, range(0, classFirst.size)));

        meanFirst = div(meanFirstDivA, sum(classFirst) );

        const meanSecFill = fill(classSecond.shape, classFirst.size);
        const meanSecAdd = add(range(0,classSecond.size),meanSecFill);
        const meanSecMul = mul(classSecond, (meanSecAdd));
        meanSec = div(sum(meanSecMul), sum(classSecond));

        const cInBetVarSubA = sub(meanFirst, meanSec);
        const cInBetVarSubB = sub(meanFirst, meanSec);
        const cInBetVarMul = mul(weightForeground, weightBack);
        cInBetVar = mul(mul(cInBetVarMul,cInBetVarSubA), cInBetVarSubB);

        const condition = greater(cInBetVar, bestInBetVar);

        bestInBetVar = where(condition, cInBetVar, bestInBetVar);

        bestThresh = where(condition, tensor1d([index]), bestThresh);

    }
    return bestThresh;
}

function triangle (histogram: Tensor1D){

    const histogramTrimmed = trimZeros(histogram);

    const maxIdx = + argMax(histogramTrimmed).toString().replace(/[^0-9]/g, '');

    const increasing = lessEqual(histogramTrimmed.shape[0]/2, maxIdx)
        .toString().includes('true');

    const sliced = increasing ? slice(histogramTrimmed, 0, maxIdx+1) :
        slice(histogramTrimmed, maxIdx);

    const cathetusB = max(sliced);

    const cathetusA = sliced.shape;

    const aTan = atan(div(cathetusB, cathetusA));

    let derivativeTriangle = increasing ? range(1, cathetusA[0]+1, 1 ,'float32')
        :
        range(cathetusA[0], 0, -1 ,'float32') ;

    derivativeTriangle = mul(derivativeTriangle, tan(aTan));

    let cathetusDerivativeB  = sub(derivativeTriangle, sliced);

    cathetusDerivativeB = where(less(cathetusDerivativeB,0),
        zerosLike(cathetusDerivativeB), cathetusDerivativeB);

    const cathetusDerivativeA =  div(cathetusDerivativeB, tan(aTan));

    const hiposDerivate = sqrt( add( pow(cathetusDerivativeA,2 ),
        pow(cathetusDerivativeB,2)    )  );

    const heights = div(mul(cathetusDerivativeB, cathetusDerivativeA)
        , hiposDerivate);

    const maxheightIdx = argMax(heights);

    const valueInHistoSliced = gatherND(sliced, reshape(maxheightIdx, [1]));

    const bestThresh =  argMin( abs(sub(histogram, valueInHistoSliced)) );

    return bestThresh;

}

function trimZeros(histogram: Tensor1D){

    const histogramCopy = clone(histogram);

    const divideToZero = div(histogramCopy,0);

    const leftPointer = + argMax(divideToZero)
        .toString().replace(/[^0-9]/g, '');

    const leftSideClean = slice(histogramCopy, leftPointer);

    const divideToMZero = div(reverse(leftSideClean), -0);

    const rightPointer = + argMin(divideToMZero)
        .toString().replace(/[^0-9]/g, '');

    const clean = slice(leftSideClean,
        0, leftSideClean.shape[0] - rightPointer );

    return clean;
}

export const threshold = op({ threshold_ });
