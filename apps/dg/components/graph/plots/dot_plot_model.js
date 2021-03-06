// ==========================================================================
//                            DG.DotPlotModel
//
//  Author:   William Finzer
//
//  Copyright (c) 2014 by The Concord Consortium, Inc. All rights reserved.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.
// ==========================================================================

sc_require('components/graph/plots/plot_model');
sc_require('components/graph/plots/numeric_plot_model_mixin');

/** @class  DG.DotPlotModel The model for a dot plot.

  @extends SC.PlotModel
*/
DG.DotPlotModel = DG.PlotModel.extend( DG.NumericPlotModelMixin,
/** @scope DG.DotPlotModel.prototype */ 
{
  /**
  @property{Number}
  */
  primaryVarID: function() {
    return (this.get('primaryAxisPlace') === DG.GraphTypes.EPlace.eX) ?
              this.get('xVarID') : this.get('yVarID');
  }.property('primaryAxisPlace', 'xVarID', 'yVarID')/*.cacheable()*/,

  /**
  @property{DG.GraphTypes.EPlace}
  */
  primaryAxisPlace: function() {
    var dataConfiguration = this.get('dataConfiguration');
    return dataConfiguration && dataConfiguration.getPlaceForRole( DG.Analysis.EAnalysisRole.ePrimaryNumeric);
  }.property('xVarID', 'yVarID')/*.cacheable()*/,

  /**
  @property{DG.GraphTypes.EPlace}
  */
  secondaryAxisPlace: function() {
    var dataConfiguration = this.get('dataConfiguration');
    return dataConfiguration && dataConfiguration.getPlaceForRole( DG.Analysis.EAnalysisRole.eSecondaryCategorical);
  }.property('xVarID', 'yVarID')/*.cacheable()*/,

  /**
  @property{DG.CellLinearAxisModel}
  */
  primaryAxisModel: function() {
    return this.getAxisForPlace( this.get('primaryAxisPlace'));
  }.property('primaryAxisPlace', 'xAxis', 'yAxis')/*.cacheable()*/,

  /**
  @property{DG.CellLinearAxisModel}
  */
  secondaryAxisModel: function() {
    return this.getAxisForPlace( this.get('secondaryAxisPlace'));
  }.property('secondaryAxisPlace', 'xAxis', 'yAxis')/*.cacheable()*/,

  /**
    'vertical' means the stacks of dots are vertical, while 'horizontal' means they are horizontal
    @property{String}
    */
    orientation: function() {
      return (this.get('primaryAxisPlace') === DG.GraphTypes.EPlace.eX) ? 'vertical' : 'horizontal';
    }.property('primaryAxisPlace'),

  /**
    If we need to make a movable value, do so. In any event toggle its visibility.
  */
  toggleMovableValue: function() {
    var movableValue = this.toggleAdornmentVisibility('movableValue', 'toggleMovableValue');
    if( movableValue && movableValue.get('isVisible'))
      movableValue.recomputeValue( this.get('primaryAxisModel'));
  },

  /**
    Toggle the visibility of the specified DG.PlottedAverageModel.
    Will create the adornment the first time it's shown.
    @param    {String}    iAdornmentKey -- e.g. 'plottedMean'
    @param    {String}    iToggleLogString -- Name of action logged to server
   */
  toggleAverage: function( iAdornmentKey, iToggleLogString ) {
    var this_ = this;

    function toggle() {
      var avg = this_.toggleAdornmentVisibility( iAdornmentKey, iToggleLogString );
      if( avg ) {
        if( avg.get('isVisible')) {
          avg.recomputeValue();     // initialize
        } else {
          avg.setComputingNeeded(); // make sure we recompute when made visible again
        }
      }
      return !avg || avg.get('isVisible');
    }

    DG.UndoHistory.execute(DG.Command.create({
      name: "graph."+iToggleLogString,  // e.g. graph.togglePlottedMean
      undoString: null,
      log: iToggleLogString,
      execute: function() {
        var wasShown = toggle(),

            verb     = wasShown ? "show" : "hide",
            action   = iToggleLogString.replace("toggle", verb);

        this.set('undoString', 'DG.Undo.graph.'+action); // e.g. DG.Undo.graph.showPlottedMean
        this.set('redoString', 'DG.Redo.graph.'+action);
      },
      undo: function() {
        toggle();
      },
    }));
  },

  /**
   Toggle the visibility of the mean.
   */
  togglePlottedMean: function() {
    this.toggleAverage('plottedMean', 'togglePlottedMean');
  },

  /**
   Toggle the visibility of the median.
  */
  togglePlottedMedian: function() {
    this.toggleAverage('plottedMedian', 'togglePlottedMedian');
  },

  /**
   Toggle the visibility of the Standard Deviation.
   */
  togglePlottedStDev: function() {
    this.toggleAverage('plottedStDev', 'togglePlottedStDev');
  },
  
  /**
   Toggle the visibility of the Standard Deviation.
   */
  togglePlottedIQR: function() {
    this.toggleAverage('plottedIQR', 'togglePlottedIQR');
  },

  /**
    If we need to make a plotted Value, do so. In any event toggle its visibility.
  */
  togglePlotValue: function() {
    this.toggleAdornmentVisibility('plottedValue', 'togglePlotValue');
  },

  handleDataConfigurationChange: function() {
    if( !DG.assert( !this.get('isDestroyed'), "DG.DotPlotModel.handleDataConfiguration() shouldn't be triggered after destroy()!"))
      return;
    sc_super();
    var kAllowShrinkage = true, kAnimate = true, kDontLog = false;
    this.rescaleAxesFromData( kAllowShrinkage, kAnimate, kDontLog);
    
    ['movableValue','plottedMean','plottedMedian','plottedStDev','plottedIQR','plottedCount'].
      forEach( function( iAdornmentKey) {
                  var adornmentModel = this.getAdornmentModel( iAdornmentKey);
                  if( adornmentModel) {
                    if( adornmentModel.setComputingNeeded)
                      adornmentModel.setComputingNeeded();  // invalidate if axis model/attribute change
                    if( iAdornmentKey === 'movableValue') {
                      adornmentModel.recomputeValueIfNeeded( this.get('primaryAxisModel'));
                    }
                    else {
                      adornmentModel.recomputeValueIfNeeded(); // recompute only if/when visible
                    }
                  }
              }.bind( this));
  },

  /**
    Each axis should rescale based on the values to be plotted with it.
    @param{Boolean} Default is false
    @param{Boolean} Default is true
    @param{Boolean} Default is false
    @param{Boolean} Default is false
  */
  rescaleAxesFromData: function( iAllowScaleShrinkage, iAnimatePoints, iLogIt, iUserAction) {
    if( iAnimatePoints === undefined)
      iAnimatePoints = true;
    this.doRescaleAxesFromData( [ this.get('primaryAxisPlace')], iAllowScaleShrinkage, iAnimatePoints, iUserAction);
    if( iLogIt)
      DG.logUser("rescaleDotPlot");
  },

  /**
    @param{ {x: {Number}, y: {Number} } }
    @param{Number}
  */
  dilate: function( iFixedPoint, iFactor) {
    this.doDilation( [ this.get('primaryAxisPlace')], iFixedPoint, iFactor);
  },

  /**
   * Get an array of non-missing case counts in each axis cell.
   * Also cell index on primary and secondary axis, with primary axis as major axis.
   * @return {Array} [{count, primaryCell, secondaryCell},...] (all values are integers 0+).
   */
  getCellCaseCounts: function() {
    var tCases = this.get('cases'),
        tNumericVarID = this.get('primaryVarID'),
        tNumericAxisModel = this.get('primaryAxisModel'),
        tCategoricalVarID = this.get('secondaryVarID'),
        tCategoricalAxisModel = this.get('secondaryAxisModel'),
        tValueArray = [];

    if( !( tCategoricalAxisModel && tNumericAxisModel )) {
      return tValueArray; // too early to recompute, caller must try again later.
    }

    var tNumCells = tCategoricalAxisModel.get('numberOfCells');

    // initialize the values
    for( var i=0; i<tNumCells; ++i ) {
      tValueArray.push({ count: 0, primaryCell: 0, secondaryCell: i });
    }

    // compute count of cases in each cell, excluding missing values
    // take care to handle null VarIDs and null case values correctly
    tCases.forEach( function( iCase, iIndex ) {
      var tNumericValue = iCase.getNumValue( tNumericVarID),
          tCellValue = iCase.getStrValue( tCategoricalVarID),
          tCellNumber = tCategoricalAxisModel.cellNameToCellNumber( tCellValue);
      if( tCellNumber!==null &&
          DG.MathUtilities.isInIntegerRange( tCellNumber, 0, tValueArray.length) && // if Cell Number not missing
          isFinite( tNumericValue)) { // if numeric value not missing
        tValueArray[tCellNumber].count += 1;
      }
    });

    return tValueArray;
  },

  checkboxDescriptions: function() {
    var this_ = this;
    return sc_super().concat([
      {
        title: 'DG.Inspector.graphMovableValue',
        value: this_.isAdornmentVisible('movableValue'),
        classNames: 'graph-movableValue-check'.w(),
        valueDidChange: function () {
          this_.toggleMovableValue();
        }.observes('value')
      },
      {
        title: 'DG.Inspector.graphPlottedMean',
        value: this_.isAdornmentVisible('plottedMean'),
        classNames: 'graph-plottedMean-check'.w(),
        valueDidChange: function () {
          this_.togglePlottedMean();
        }.observes('value')
      },
      {
        title: 'DG.Inspector.graphPlottedMedian',
        value: this_.isAdornmentVisible('plottedMedian'),
        classNames: 'graph-plottedMedian-check'.w(),
        valueDidChange: function () {
          this_.togglePlottedMedian();
        }.observes('value')
      },
      {
        title: 'DG.Inspector.graphPlottedStDev',
        value: this_.isAdornmentVisible('plottedStDev'),
        classNames: 'graph-plottedStDev-check'.w(),
        valueDidChange: function () {
          this_.togglePlottedStDev();
        }.observes('value')
      },
      {
        title: 'DG.Inspector.graphPlottedIQR',
        value: this_.isAdornmentVisible('plottedIQR'),
        classNames: 'graph-plottedIQR-check'.w(),
        valueDidChange: function () {
          this_.togglePlottedIQR();
        }.observes('value')
      },
      {
        title: 'DG.Inspector.graphPlottedValue',
        value: this_.isAdornmentVisible('plottedValue'),
        classNames: 'graph-plottedValue-check'.w(),
        valueDidChange: function () {
          this_.togglePlotValue();
        }.observes('value')
      }
    ]);
  }.property()
});

/**
  class method called before plot creation to make sure roles are correct
  @param {DG.GraphDataConfiguration}
*/
DG.DotPlotModel.configureRoles = function( iConfig) {
  var tXType = iConfig.get('xType'),
      tAxisKey = (tXType === DG.Analysis.EAttributeType.eNumeric) ? 'x' : 'y',
      tOtherAxisKey = (tAxisKey === 'x') ? 'y' : 'x';
  iConfig.setPath( tAxisKey + 'AttributeDescription.role',
                    DG.Analysis.EAnalysisRole.ePrimaryNumeric);
  iConfig.setPath( tOtherAxisKey + 'AttributeDescription.role',
                    DG.Analysis.EAnalysisRole.eSecondaryCategorical);
};

