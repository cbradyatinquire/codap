// ==========================================================================
//                            DG.PlotLayer
//
//  Author:   William Finzer
//
//  Copyright ©2014 Concord Consortium
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

sc_require('alpha/destroyable');
sc_require('components/graph/utilities/plot_utilities');
sc_require('libraries/RTree');
/*global RTree:true */

/** @class  DG.PlotLayer - The base class for plotting points using Raphael.

  @extends SC.Object.extend
*/
DG.PlotLayer = SC.Object.extend( DG.Destroyable,
/** @scope DG.PlotLayer.prototype */ 
{
  autoDestroyProperties: ['_dataTip'],

  /**
   * The paper we draw on is shared, not owned.
   * @property {DG.RaphaelBase}
   */
  paperSource: null,

  /**
   * @property {Raphael paper}
   */
/*
  paper: function() {
    return this.getPath('paperSource.paper');
  }.property('paperSource.paper'),
*/
  paperBinding: 'paperSource.paper',
  /**
   * @property {DG.LayerManager}
   */
/*
  layerManager: function() {
    return this.getPath('paperSource.layerManager');
  }.property('paperSource.layerManager' ),
*/
  layerManagerBinding: 'paperSource.layerManager',

  /**
   * Get from paperSource
   * @property {}
   */
/*
  frame: function() {
    return this.getPath('paperSource.frame');
  }.property('paperSource.frame'),
*/
  frameBinding: 'paperSource.frame',

  /**
   * Get from paperSource
   * @property {}
   */
  elementsToClear: function() {
    return this.getPath('paperSource._elementsToClear');
  }.property('paperSource._elementsToClear'),

  /**
   * @private
   * @property { DG.PointDataTip } for displaying attributes of whatever is underneath the mouse
   */
  _dataTip: null,

  /**
   * Lazy instantiation.
   * @property {DG.PointDataTip }
   */
  dataTip: function() {
    if( !this._dataTip) {
      this._dataTip = DG.PointDataTip.create( { plotLayer: this, layerName: DG.LayerNames.kDataTip });
    }
    return this._dataTip;
  }.property(),

  /**
   * Since we are not a view, we notify so that the view that owns us can take
   * appropriate action.
   */
  displayDidChange: function() {
    this.notifyPropertyChange('plotDisplayDidChange');
  },

  /**
    The model on which this view is based.
    @property { DG.PlotModel|DG.MapModel }
  */
  model: null,

  /**
    @property { DG.DataContext }  The data context
  */
/*
  dataContext: function() {
    return this.getPath('model.dataContext');
  }.property('model.dataContext'),
*/
  dataContextBinding: 'model.dataContext',

  selection: null,
  selectionBinding: '*model.casesController.selection',

  /**
   * If defined, this function gets called after cases have been added or values changed, but only once,
   * and only after a sufficient time has elapsed.
   * @property { Function }
   */
    cleanupFunc: null,

  /**
   * Wait at least this long before calling cleanupFunc
   * @property {Number} in milliseconds
   */
    cleanupDelay: 300,

  /**
   * While waiting to do a cleanup, call installCleanup at this interval to check to see if now is the time.
   * @property {Number} in milliseconds
   */
    cleanupInterval: 300,

  /**
   * Are we already awaiting an opportunity to cleanup?
   * @property {Boolean}
   */
    waitingForCleanup: false,

  /**
   * Time at which the last call for a cleanup occurred.
   * @property {Number}
   */
    timeOfLastCleanupCall: null,

  /**
   * Used to schedule cleanup. We hold onto it so we can invalidate it during destroy.
   * @property {SC.Timer}
   */
    cleanupTimer: null,

  installCleanup: function() {
    if( !this.cleanupFunc)
      return;

    var checkTime = function() {
      var tNow = Date.now();
      if( tNow - this.timeOfLastCleanupCall > this.cleanupDelay) {
        this.cleanupFunc();
        this.waitingForCleanup = false;
        this.cleanupTimer = null;
      }
      else {
        this.cleanupTimer = SC.Timer.schedule( { target: this, action: checkTime, interval: this.cleanupInterval });
      }
    };

    this.timeOfLastCleanupCall = Date.now();
    if( !this.waitingForCleanup) {
      this.waitingForCleanup = true;
      this.cleanupTimer = SC.Timer.schedule( { target: this, action: checkTime, interval: this.cleanupInterval });
    }
  },

  /**
    @property { String }
  */
  changeKey: 'dataDidChange',

  /**
   * @property { Number } current point radius of cases being displayed.
   */
  _pointRadius: DG.PlotUtilities.kPointRadiusMax,

  /**
   * If this is non-null, it will be used as the radius for points regardless of number of points
   * {@property Number}
   */
  fixedPointRadius: null,

  /**
    True if rendered content is up-to-date, false if redraw is required.
    @property { Boolean }
   */
  _isRenderingValid: false,

  blankDropHint: 'DG.GraphView.dropInPlot',

  /**
   * Refers specifically to a legend attribute
   * @property {DG.Attribute}
   */
  plottedAttribute: function() {
    return this.getPath('model.dataConfiguration.legendAttributeDescription.attribute');
  }.property(),

  /**
    Prepare dependencies.
  */
  init: function() {
    sc_super();
    if( this.get('model')) {
      // Required for initialization.
      this.modelDidChange();
    }
    this._plottedElements = [];
  },

  /**
    Prepare dependencies.
  */
  modelDidChange: function( iSource, iKey) {
    this.dataConfigurationDidChange( iSource, iKey);

    // We want dataDidChange to be called when cases change
    this.addObserver('model.dataConfiguration.cases', this, 'dataDidChange');
    this.addObserver('model.dataConfiguration.hiddenCases', this, 'dataDidChange');
    this.addObserver('model.dataConfiguration.dataContext.selectionChangeCount', this, 'selectionChangeCount');

    this._isRenderingValid = false;
  }.observes('model'),

  /**
    Here we set up observers so that if the length of a data array is changed, dataDidChange
    is called, and if a case value changes (which changes its 'revision' property), dataRangeDidChange
    gets called.
  */
  dataConfigurationDidChange: function( iSource, iKey ) {
    // initialize point radius when attaching new set of cases, since dataDidChange() is not called then.
    this._pointRadius = this.calcPointRadius();

    this._isRenderingValid = false;
  },

  destroy: function() {
    this.removePlottedElements();
    this.removeObserver('model.dataConfiguration.cases', this, 'dataDidChange');
    this.removeObserver('model.dataConfiguration.hiddenCases', this, 'dataDidChange');
    this.removeObserver('model.dataConfiguration.dataContext.selectionChangeCount', this, 'selectionChangeCount');
    if( this.cleanupTimer)
      this.cleanupTimer.invalidate();
    this.model = null;

    sc_super();
  },

  /**
    Respond to DataContext notifications from the PlotModel.
   */
  handleDataContextNotification: function( iSource, iKey) {
    var tModel = this.get('model'),
        lastChange = tModel && tModel.get('lastChange'),
        operation = lastChange && lastChange.operation;
    
    // No response necessary if plot isn't affected.
    if( !tModel || !tModel.isAffectedByChange( lastChange))
      return;

    switch( operation) {
      case 'createCase':
      case 'createCases':
      case 'deleteCases':
      case 'createCollection':
      case 'resetCollections':
        // usually dataDidChange, but derived classes can override
        var changeKey = this.get('changeKey');
        if( !SC.empty( changeKey)) {
          var handler = this[ changeKey];
          if( handler)
            handler.call( this, iKey);
        }
        break;
      case 'updateCases':
      case 'createAttributes':
      case 'updateAttributes':
      case 'deleteAttributes':
        this.dataRangeDidChange( this, 'revision', this, lastChange.indices);
        break;
      case 'selectCases':
        this.selectionDidChange();
        break;
    }
  }.observes('.model.lastChange'),
  
  /**
    Observer function triggered when the plot configuration changes.
   */
  plotConfigurationDidChange: function() {
    this._isRenderingValid = false;
    this.displayDidChange();
  }.observes('.model.plotConfiguration'),
  
  /**
    Observer function called when the view/paper is resized.
   */
  paperSizeDidChange: function() {
    this._isRenderingValid = false;
    this.displayDidChange();
  }.observes('paperSize'),

  selectionChangeCount: function() {
    this._elementOrderIsValid = false;
  },

  /**
    Give subclasses a chance to do whatever they need to do before we recompute all the
    point coordinates.
  */
  prepareToResetCoordinates: function() {
  },
  
  /**
    Utility function to be called when the coordinates of all circles must be updated.
    New circle elements will be created if necessary, but this method never removes
    elements so it cannot be used to handle deletion of cases.
   */
  refreshCoordinates: function() {
    if( this.get('paper'))
      this.drawData();
  },

  callCreateCircle: function( iCase, iIndex, iAnimate) {
    var tCircle = this.createCircle( iCase, iIndex, iAnimate);
    if( tCircle) {
      this._plottedElements.push( tCircle );
      this.getPath('layerManager.' + DG.LayerNames.kPoints ).push( tCircle);
    }
    return tCircle;
  },

  /**
    Plots that show data as points should be able to use this as is. Others will probably
    override.
  */
  dataDidChange: function() {
    if( !this.readyToDraw())
      return;   // not ready to create elements yet
    var this_ = this,
        tCases = this.getPath('model.cases'),
        tRC = this.createRenderContext(),
        tDataLength = tCases && tCases.length,
        tPlotElementLength = this._plottedElements.length,
        tWantNewPointRadius = (this._pointRadius !== this.calcPointRadius()),
        tLayerManager = this.get('layerManager' ),
        tIndex;
    // We don't redraw if tCases is undefined. This can happen during the
    // deletion of the plot model
    if (tCases === undefined) { return; }

    this._elementOrderIsValid = false;
    // update the point radius before creating or updating plotted elements
    if( tWantNewPointRadius ) {
      this._pointRadius = this.calcPointRadius();
      this._isRenderingValid = false;
      this.displayDidChange();
    }
    // update adornments when cases added or removed
    // note: don't rely on tDataLength != tPlotElementLength test for this
    this.updateAdornments();

    if( tRC && (tDataLength !== tPlotElementLength)) {
      // for any new cases
      if (tDataLength > tPlotElementLength) {
        if (tWantNewPointRadius) {
          // update the point radius for existing plotted elements
          this.prepareToResetCoordinates();
          for (tIndex = 0; tIndex < tPlotElementLength; tIndex++) {
            this.setCircleCoordinate(tRC, tCases[ tIndex], tIndex);
          }
        }
        // create plot elements for added cases
        for (tIndex = tPlotElementLength; tIndex < tDataLength; tIndex++) {
          this.callCreateCircle(tCases[ tIndex], tIndex, this.animationIsAllowable());
          this.setCircleCoordinate(tRC, tCases[ tIndex], tIndex);
        }
      }
      // Get rid of plot elements for removed cases and update all coordinates
      if (tDataLength < tPlotElementLength) {
        for (tIndex = tDataLength; tIndex < tPlotElementLength; tIndex++) {
          // It can happen during closing of a document that the elements no longer exist, so we have to test
          if (!SC.none(this._plottedElements[ tIndex])) {
            this._plottedElements[ tIndex].stop();
            tLayerManager.removeElement(this._plottedElements[ tIndex]);
            DG.PlotUtilities.doHideRemoveAnimation(this._plottedElements[ tIndex]);
          }
        }
        this._plottedElements.length = tDataLength;

        this.prepareToResetCoordinates();
        tCases.forEach(function (iCase, iIndex) {
          this_.setCircleCoordinate(tRC, tCases[ iIndex], iIndex);
        });
      }
      this._isRenderingValid = false;
      this.displayDidChange();
    }

    // There might be some cleanup that has to be done after a suitable waiting time
    this.installCleanup();
  },

  /**
    Subclasses should call sc_super()
  */
  dataRangeDidChange: function( iSource, iQuestion, iKey, iChanges) {
    this.updateAdornments();
    this.get('dataTip').handleChanges( iChanges);
  },

  /**
   * Subclasses may override
   */
  updateAdornments: function() {

  },

  /**
   * We determine if sufficient time has passed since the last call to allow (expensive) animation
   * to occur in createCircle.
   * Note that this side effects _createAnimationOn and _timeLastCreate.
   * @return {Boolean}
   */
 animationIsAllowable: function() {
    var tNow = Date.now(),
        tDelta = tNow - this._timeLastCreate;
    if( tDelta < DG.PlotUtilities.kDefaultAnimationTime) {
      this._createAnimationOn = false;
    }
    else if(tNow - this._timeLastCreate > this._kAllowableInterval)
      this._createAnimationOn = true;
    this._timeLastCreate = tNow;
    return this._createAnimationOn;
  },

  /**
   * If we have paper, we're ready to draw.
   * @return {Boolean}
   */
  readyToDraw: function() {
    return !SC.none( this.get('paper'));
  },
  
  /**
   * Properties having to do with determining whether createCircle animation should be turned on
   */

  /**
   * The last time we called createCircle. If sufficient time has elapsed, we can turn on animation
   */
  _timeLastCreate: null,

  /**
   * Controls whether we allow createCircle to do an animation. Turned off when animations are overlapping.
   * Turned back on when sufficient time has elapsed.
   */
  _createAnimationOn: true,

  _kAllowableInterval: 1000, // milliseconds

  /**
  */
  animationStateDidChange: function() {
    if( this.getPath('model.isAnimating'))
      this.enterAnimationState();
    else
      this.leaveAnimationState();
  }.observes('.model.isAnimating'),

  /**
    Subclasses should override in order to animate plotted elements to new coordinates.
    These can be computed now, but should not be computed again until we leave animation state.
  */
  enterAnimationState: function() {
  },

  /**
    Subclasses should override in order do any cleanup necessary when an animation ends.
  */
  leaveAnimationState: function() {
  },

  // Private properties
  _plottedElements: null, // Kept in the same order as the data
  _mustCreatePlottedElements: true,
  _elementOrderIsValid: false,  // Set to false when selection changes
  
  /**
    If we're still valid, skip the whole render process.
   */
  shouldDraw: function() {
    return !this._isRenderingValid;
  },

  /**
    Subclasses will override
  */
  drawData: function drawData() {
    if( !this.get('paper')) return; // abort if not yet ready to draw

    var this_ = this,
        tCases = this.getPath('model.cases'),
        tRC = this.createRenderContext(),
        tLayerManager = this.get('layerManager' ),
        tPlotElementLength = this._plottedElements.length,
        tIndex;

    if( SC.none( tCases))
      return; // No cases, nothing to draw

    // remove invalid case elements
    if( this._mustCreatePlottedElements) {
      this._plottedElements.forEach( function( iElement) {
        tLayerManager.removeElement (iElement); // remove from plot
        });
      tPlotElementLength = this._plottedElements.length = 0; // remove from array
      this._mustCreatePlottedElements = false;
      tRC.casesAdded = true; // ensure that cases are re-created below
    }

    // remove extra case elements
    if( tRC.casesRemoved ) {
      for( tIndex = tCases.length; tIndex < tPlotElementLength; tIndex++) {
        DG.PlotUtilities.doHideRemoveAnimation( this._plottedElements[ tIndex], tLayerManager);
      }
      if( tCases.length < tPlotElementLength ) { // remove from array
        tPlotElementLength = this._plottedElements.length = tCases.length;
      }
    }

    // update the cached circle size (dependent on the number of cases)
    if( tRC.casesAdded ) {
      this._pointRadius = this.calcPointRadius();
    }

    // If we're going to be adding cases, then we'll want to call updateSelection because
    // these new cases may be selected. Setting _elementOrderIsValid to false accomplishes this.
    if( tPlotElementLength < tCases.length)
      this_._elementOrderIsValid = false;

    // update case elements, adding them if necessary
    if( tRC.updatedPositions || tRC.updatedColors || tRC.casesAdded ) {
      this.prepareToResetCoordinates();
      tCases.forEach( function( iCase, iIndex) {
                        if( iIndex >= tPlotElementLength )
                          this_.callCreateCircle( tCases[ iIndex], iIndex, true);
                        this_.setCircleCoordinate( tRC, tCases[ iIndex], iIndex);
                      });
    }
    DG.assert( this._plottedElements.length === tCases.length );
  },

  /**
    Set our _isRenderingValid flag when rendering is complete.
   */
  didDraw: function() {
    sc_super();
    this._isRenderingValid = true;
  },

  /**

  */
  selectionDidChange: function() {
    this.updateSelection();
    this._isRenderingValid = false;
  }.observes('selection'),

  /**
    Get case icon CSS class; extended objects can override for different look to elements.
    @param {boolean} iIsSelected Is the case selected?
    @param {boolean} iIsColored Is the case one whose color is given by a legend attribute (defaults to false)
    @returns {string}
  */
  getPlottedElementClass: function( iIsSelected, iIsColored ) {
    return( iIsColored ?
                (iIsSelected ? DG.PlotUtilities.kSelectedColoredDotClassName : DG.PlotUtilities.kColoredDotClassName ) :
                (iIsSelected ? DG.PlotUtilities.kSelectedDotClassName : DG.PlotUtilities.kDotClassName ));
  },

  /**
    For each case, set the fill of its corresponding point to show its selection state
  */
  updateSelection: function() {
    if( !this.get('model'))
      return;   // because this can get called by pending changes after I have been destroyed
    if( this._elementOrderIsValid)
      return;

    var this_ = this,
      tPlottedElements = this._plottedElements,
      // Use long path for selection because we can call this before bindings have happened
      // There must be a better way?
      tSelection = this.getPath('model.dataConfiguration.collectionClient.casesController.selection'),
      // Points are 'colored' if there is a legend or if there is more than one plot
      tIsColored = (this.getPath('model.dataConfiguration.legendAttributeDescription.attribute') !==
                                          DG.Analysis.kNullAttribute) ||
                      (this.get('numPlots') > 1),
      tLayerManager = this.get('layerManager' ),
      tCases = this.getPath('model.cases');

    if(!tCases || !tSelection)
      return;

    tCases.forEach( function( iCase, iIndex) {
      var tIsSelected, tElement, tFrom, tTo, tClass;
        // We sometimes get here with fewer plotted elements than cases,
        // perhaps when newly added cases don't have plottable values.
      if( (iIndex < tPlottedElements.length) && tPlottedElements[ iIndex]) {
        tElement = tPlottedElements[ iIndex];
        tIsSelected = tSelection.containsObject( iCase);
        tFrom = tIsSelected ? DG.LayerNames.kPoints : DG.LayerNames.kSelectedPoints;
        tTo = tIsSelected ? DG.LayerNames.kSelectedPoints : DG.LayerNames.kPoints;
        tClass = this_.getPlottedElementClass( tIsSelected, tIsColored );
        if (!tElement.hasClass(tClass)) {
          DG.PlotUtilities.kDotClasses.forEach(function (iClass) {
            tElement.removeClass(iClass);
          });
          tElement.addClass(this_.getPlottedElementClass(tIsSelected,
            tIsColored));
          tLayerManager.moveElementFromTo(tElement, tFrom, tTo);
        }
      }
    });
    this._elementOrderIsValid = true;
  },

  _selectionTree: null,

  preparePointSelection: function() {
    var tCases = this.getPath('model.cases' );

    this._selectionTree = new RTree();
    this._plottedElements.forEach(function(iElement, iIndex){
      this._selectionTree.insert({
          x: iElement.attrs.cx,
          y: iElement.attrs.cy,
          w: 1,
          h: 1
        },
        tCases[iIndex]
      );
    }.bind(this));
  },
  cleanUpPointSelection: function () {
    this._selectionTree = null;
  },
  /**
   * Gets the cases which are in iNewRect ignoring those in the region defined by
   * iLastRect.
   * This function is usable for incremental selection.
   * @param iNewRect
   * @param iLastRect
   */
  getCasesForDelta: function(iNewRect, iLastRect) {
    /**
     * Returns the intersection of the two rectangles. Zero area intersections
     * (adjacencies) are handled as if they where not intersections.
     *
     * @param {{x:number,y:number,width:number,height:number}} iA
     * @param {{x:number,y:number,width:number,height:number}} iB
     * @return {[{x:number,y:number,width:number,height:number}]|null}
     */
    function rectangleIntersect(iA, iB) {
      var left = Math.max(iA.x, iB.x);
      var right = Math.min(iA.x + iA.width, iB.x + iB.width);
      var top = Math.max(iA.y, iB.y);
      var bottom = Math.min(iA.y + iA.height, iB.y + iB.height);

      if (right - left <= 0 || bottom - top <= 0) return null;
      return {x:left, y: top, width: right - left, height: bottom - top};
    }
    /**
     * Returns an array of zero, one, or more rectangles that represent the
     * remainder of the first rectangle after the intersection with the second
     * rectangle is removed. If the rectangle do not intersect, then the whole of
     * the firs rectangle is returned.
     *
     * @param {{x:number,y:number,width:number,height:number}} iA
     * @param {{x:number,y:number,width:number,height:number}} iB
     * @return {[{x:number,y:number,width:number,height:number}]}
     */
    function rectangleSubtract(iA, iB) {
      var intersectRect = rectangleIntersect(iA, iB);
      var result = [];
      var intersectLR;
      var rectangleALR;

      if (intersectRect) {
        intersectLR = {x:intersectRect.x + intersectRect.width, y:intersectRect.y + intersectRect.height};
        rectangleALR = {x:iA.x + iA.width, y:iA.y + iA.height};
        if (iA.x < intersectRect.x) {
          result.push({
            x: iA.x, y: iA.y, width: intersectRect.x - iA.x, height: iA.height
          });
        }
        if (intersectLR.x < rectangleALR.x) {
          result.push({
            x: intersectLR.x, y: iA.y, width: rectangleALR.x - intersectLR.x, height: iA.height
          });
        }
        if (iA.y < intersectRect.y) {
          result.push({
            x: intersectRect.x, y: iA.y, width: intersectRect.width, height: intersectRect.y - iA.y
          });
        }
        if (intersectLR.y < rectangleALR.y) {
          result.push({
            x: intersectRect.x, y: intersectLR.y, width: intersectRect.width, height: rectangleALR.y - intersectLR.y
          });
        }
      } else {
        result.push(iA);
      }

      return result;
    }
    var rects = rectangleSubtract(iNewRect, iLastRect);
    var selected = [];


    rects.forEach(function (iRect) {
      var tRect;
      var tSelected;
      tRect = {x: iRect.x, y: iRect.y, w: iRect.width, h: iRect.height};
      tSelected = this._selectionTree.search(tRect);
      if (tSelected && tSelected.length>0) {
        selected = selected.concat(tSelected);
      }
    }.bind(this));
    return selected;
  },
  /**
    @param {{ x: {Number}, y: {Number}, width: {Number}, height: {Number} }} iRect
    @return {Array} of DG.Case
  */
  getCasesForPointsInRect: function( iRect) {
    var tCases, tSelected, tRect;

    if (this._selectionTree) {
      tRect = {x: iRect.x, y: iRect.y, w: iRect.width, h: iRect.height};
      tSelected = this._selectionTree.search(tRect);
    } else {
      tCases = this.getPath('model.cases' );
      tSelected = [];

      this._plottedElements.forEach( function( iElement, iIndex) {
        if( DG.ViewUtilities.ptInRect( { x: iElement.attrs.cx, y: iElement.attrs.cy }, iRect))
          tSelected.push( tCases[ iIndex]);
      });
    }
    return tSelected;
  },

  /**
   * Remove all plotted elements
   */
  removePlottedElements: function( iAnimate) {
    var tLayerManager = this.get('layerManager');
    this._plottedElements.forEach( function(iElement) {
      iElement.stop();
      if( iAnimate) {
        DG.PlotUtilities.doHideRemoveAnimation( iElement, tLayerManager);
      }
      else
        tLayerManager.removeElement( iElement);
    });
    this._plottedElements.length = 0;
  },

  /**
    @property { Number }  Takes into account any borders the parent views may have
    Kludge alert! We're dealing with a SproutCore bug with computing frames in the presence
    of borders. [SCBUG]
  */
  drawWidth: function() {
    return this.get('frame').width - 2 * DG.ViewUtilities.kBorderWidth;
  }.property('frame'),

  /**
    @property { Number }  Takes into account any borders the parent views may have
    Kludge alert! We're dealing with a SproutCore bug with computing frames in the presence
    of borders. [SCBUG]
  */
  drawHeight: function() {
    return this.get('frame').height - 2 * DG.ViewUtilities.kBorderWidth;
  }.property('frame'),

  /**
    Graph controller observes this property to detect that a drag has taken place.
    @property {{collection:{DG.CollectionRecord}, attribute:{DG.Attribute}, text:{String},
              axisOrientation:{String} }}
  */
  dragData: null,

  /**
    Attempt to assign the given attribute to this axis.
    @param {SC.Drag} iDragObject 'data' property contains 'collection', 'attribute', 'text' properties
    @param {SC.DRAG_LINK} iDragOp
  */
  performDragOperation: function( iDragObject, iDragOp) {
    this.set('dragData', iDragObject.data);
    return SC.DRAG_LINK;
  },

  showDataTip: function( iElement, iIndex) {
    this.get('dataTip').show( iElement.attr('cx'), iElement.attr('cy'), iIndex);
  },

  hideDataTip: function() {
    var tDataTip = this.get('dataTip');
    if( tDataTip)
      tDataTip.hide();
  },

  /**
   * Compute the desired point radius, which depends on the number of cases to be plotted.
   * Caller should compare to this._pointRadius (actual size of case circles already created)
   * @return {Number} radius of circle for each case, as a positive integer.
   */
  calcPointRadius: function() {
    if( this.fixedPointRadius)
      return this.fixedPointRadius;

    // Search for a point size in [min-max] range, where the point size is a power of logbase that is close to the data length.
    // This step function avoids excessive plot resizing with every change in number of cases.
    var tDataConfiguration = this.getPath('model.dataConfiguration' ),
        tDataLength = tDataConfiguration ? tDataConfiguration.getCaseCount() : 0,
        tRadius = DG.PlotUtilities.kPointRadiusMax,
        tMinSize = DG.PlotUtilities.kPointRadiusMin,
        tPower = DG.PlotUtilities.kPointRadiusLogBase;
    // for loop is fast equivalent to radius = max( minSize, maxSize - floor( log( logBase, max( dataLength, 1 )))
    for( var i=tPower; i<=tDataLength; i=i*tPower ) {
      --tRadius;
      if( tRadius <= tMinSize ) break;
    }
    DG.assert( tRadius > 0 && Math.round(tRadius)===tRadius ); // must be positive integer
    //if( tRadius !== this._pointRadius ) DG.log("CalcPointRadius() r=" + tRadius + " for "+tDataLength +" cases.");
    return tRadius;
  },

  /**
   * Subclasses will override
   * @return {*}
   */
  createRenderContext: function() {
    return { };
  },

  /**
   * Show or hide the given plot element to match it's desired status.
   * @param {Element} iPlottedElement, a Rafael element
   * @param {Boolean} iWantHidden, true if we want the element to be hidden
   * @return {Boolean} true if element is now shown.
   */
  showHidePlottedElement: function( iPlottedElement, iWantHidden /*, iAnimate*/ ) {
    var tIsHidden = iPlottedElement.isHidden();
    if( iWantHidden ) {
      if( !tIsHidden ) {
        // if want hidden but element is shown:
        // hide immediately (TODO: find a way to animate the hiding/showing),
        // and set the position/radius/color to a consistent state in case we animate after being shown.
        iPlottedElement.stop();
        iPlottedElement.hide();
        iPlottedElement.attr({cx: 0, cy: 0, r: 1, fill: DG.ColorUtilities.kMissingValueCaseColor.colorString });
      }
    } else if( tIsHidden ) {
      // if want shown but it is hidden: show (then let caller animate or jump to the new position).
      iPlottedElement.show();
      // Note that there is a possible problem in that if someone stops this animation, the element will
      // likely be invisible or only partially visible
      iPlottedElement.animate({ 'fill-opacity': DG.PlotUtilities.kDefaultPointOpacity, 'stroke-opacity': 1},
                                DG.PlotUtilities.kDefaultAnimationTime, '<>');
    }
    return !iWantHidden;
  },

  /**
   * Update the position of the plotted element.
   * Assumes but does not require that the element is visible (see showHidePlottedElement())
   * @param iPlottedElement {}
   * @param iAnimate {Boolean}
   * @param iViewX {Number}
   * @param iViewY {Number}
   * @param iRadius {Number}
   * @param iColorString {String}
   */
  updatePlottedElement: function( iPlottedElement, iViewX, iViewY, iRadius, iColorString, iAnimate, iCallback ) {
    var tAttrs = {cx: iViewX, cy: iViewY, r: iRadius, fill: iColorString,
          'fill-opacity': DG.PlotUtilities.kDefaultPointOpacity},
        tColor = DG.color( iColorString ),
        tStrokeColor;
    if( tColor.rgb) {
      tStrokeColor = tColor.darker(DG.PlotUtilities.kStrokeDarkerFactor ).color;
    }
    else {  // tColor would not have been able to 'darker'
      // Kludge!
      // Assume iColorString is missing leading '#'. This was encountered through an improper color map
      // created by Analytics. Still could fail of course.
      tStrokeColor = DG.color('#' + iColorString).darker(DG.PlotUtilities.kStrokeDarkerFactor ).color;
    }

    // Any prior positional animation is no longer valid
    if( iPlottedElement.posAnimation) {
      iPlottedElement.stop( iPlottedElement.posAnimation);
      iPlottedElement.posAnimation = null;
    }

    // Raphael animation completion function, called when animation is complete
    // with "this" set to the Raphael object.
    function completeAnimation() {
      this.posAnimation = null;
      if(iCallback)
        iCallback();
    }
    
    if( iAnimate) {
      // note: animating color does not look good (interaction with other plot changes), so update immediately
      iPlottedElement.attr( {stroke: tStrokeColor });
      
      // Hover animation changes the transform which affects positioning.
      // If we're trying to animate position, we simply complete the hover animation.
      if( iPlottedElement.hoverAnimation) {
        iPlottedElement.stop( iPlottedElement.hoverAnimation);
        iPlottedElement.hoverAnimation = null;
        iPlottedElement.transform('');
      }
      
      // Set up the position animation and start the animation
      iPlottedElement.posAnimation = Raphael.animation( tAttrs, DG.PlotUtilities.kDefaultAnimationTime,
                                                        '<>', completeAnimation);
      iPlottedElement.animate( iPlottedElement.posAnimation);
    } else {
      // Counteract any transform effect, e.g. from a hover animation
      var currTransform = iPlottedElement.transform(),
          currTransformIsIdentity = SC.empty( currTransform) || (SC.isArray( currTransform) && currTransform.length === 0)
              || (currTransform.toString() === 's1');
      if( !currTransformIsIdentity)
        iPlottedElement.transform( '');

      // Make the attribute changes we came here to make
      tAttrs.fill = iColorString;
      tAttrs.stroke = tStrokeColor;
      iPlottedElement.attr( tAttrs);
      // Some points got made but never had a chance to finish their creation animation
//      if( iPlottedElement.attr('stroke-opacity') < 1 ) {
//        iPlottedElement.animate( {'fill-opacity': DG.PlotUtilities.kDefaultPointOpacity, 'stroke-opacity': 1 },
//                                DG.PlotUtilities.kDefaultAnimationTime, '<>');
//      }

      // Restore the transform to its original value
      if( !currTransformIsIdentity)
        iPlottedElement.transform( currTransform);
    }
  },

  /**
   * Add an element to our list of temporary, about-to-vanish plot elements,
   * so that we can animate it before it disappears.  Note that this animated
   * element looks like a normal plotted element but is underneath the plotted element (in the z-axis),
   * and will be deleted at the next rendering.
   * Note: Here we assume the vanishing element is visible throughout the animation period,
   * so caller should not vanish a case if missing and therefore hidden in the new or old plot.
   * @param iOldAttrs {cx,cy,r,fill} position and other attributes of old (deleted) plotted element
   * @param iNewAttrs {cx,cy} pposition and optionally other attributes of new plotted element we apparently are merging with
   */
  vanishPlottedElement: function( iOldAttrs, iNewAttrs ) {

    function completeVanishAnimation() {
      this.hide(); // hide this element until it is deleted from elementsToClear list (at next rendering).
    }

    // create circle animation
    var tCircle = this.get('paper').circle( -100, -100, this._pointRadius ) // match createCircle()
            .toBack() // behind existing elements
            .addClass( DG.PlotUtilities.kColoredDotClassName) // match createCircle
            .attr( iOldAttrs) // starting position to match updatePlottedElement()
            .animate( iNewAttrs, DG.PlotUtilities.kDefaultAnimationTime, '<>', completeVanishAnimation );

    // add it to list of elements be erased at next rendering (ideally after animation is done)
    this.get('elementsToClear').push( tCircle );
  },

  /**
   * This gets called when the point size changes but nothing else, as for example, when we connect points
   * in a scatterplot with lines and want the point size to decrease.
   */
  updatePointSize: function() {
    this._pointRadius = this.calcPointRadius();
    var tAttr = { r: this._pointRadius };
    this._plottedElements.forEach( function( iElement) {
      iElement.animate( tAttr, DG.PlotUtilities.kDefaultAnimationTime, '<>');
    });
  }.observes('fixedPointRadius'),

  /**
    * Subclasses will override
    */
  didCreateLayer: function() {
  }

});

