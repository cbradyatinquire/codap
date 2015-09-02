// ==========================================================================
//                          DG.DataContext
//
//  The DataContext corresponds to a hierarchical data set comprised of
//  multiple collections in a linear parent/child relationship. Currently,
//  the data are limited to two levels (i.e. parent and child), but future
//  extension to support arbitrary number of levels is an eventual goal.
//  
//  Author:   Kirk Swenson
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

/** @class

  Coordinating controller which manages a set of collections that form the
  hierarchical data model.

  @extends SC.Object
*/
/*global: sc_super */
DG.DataContext = SC.Object.extend((function() // closure
/** @scope DG.DataContext.prototype */ {

  return {  // return from closure
  
  /**
   *  The type of DataContext, for use when archiving/restoring.
   *  @property {String}
   */
  type: 'DG.DataContext',
  
  /**
   *  The DG.DataContextRecord for which this is the controller.
   *  @property {DG.DataContextRecord}
   */
  model: null,
  
  /**
    The number of change requests that have been applied.
    Clients can use this like a seed value to determine when they're out of date
    and by how many changes they're behind. Clients that observe this property
    will be notified whenever a change is applied.
    @property   {Number}
   */
  changeCount: 0,
  
  /**
    The number of selection change requests that have been applied.
    Clients can use this like a seed value to determine when they're out of date
    and by how many selection changes they're behind. Clients that observe this property
    will be notified whenever a selection change is applied.
    @property   {Number}
   */
  selectionChangeCount: 0,

  /**
    Array of change objects that have been applied to/by this data context.
    Newly-applied changes are appended to the array, so the most recent changes
    are at the end.
    @property   {[Object]} Array of change objects
   */
  changes: null,
  
  /**
   *  The id of our DG.DataContextRecord.
   *  Bound to the 'id' property of the model.
   *  @property {Number}
   */
  id: function() {
    return this.getPath('model.id');
  }.property('model','model.id'),
  
  /**
   *  The collections for which this controller is responsible.
   *  Bound to the 'collections' property of the model.
   *  @property {[DG.Collection]}
   */
  collections: function() {
    return DG.ObjectMap.values(this.getPath('model.collections'));
  }.property('model','model.collections'),

  /**
   *  Map of DG.CollectionClients, corresponding one-to-one to the DG.Collections.
   *  @property {Object} Map from collectionID to DG.CollectionClients
   */
  _collectionClients: null,

  /**
    Initialization method.
   */
  init: function() {
    sc_super();
    this._collectionClients = {};
    this.changes = [];
    this.hiddenCollections = [];
  },

  /**
    Destruction method.
   */
  destroy: function() {
    var i, collectionCount = this.get('collectionCount');
    for( i=0; i<collectionCount; ++i) {
      var collection = this.getCollectionAtIndex( i);
      if( collection) this.willRemoveCollection( collection);
    }
    sc_super();
  },

  /**
    Returns an array of DG.Case objects corresponding to the selected cases.
    Note that the cases may come from multiple collections within the data context.
    @returns    {[DG.Case]}    The currently selected cases
   */
  getSelectedCases: function() {
    var i, collectionCount = this.get('collectionCount'),
        selection = [];

    // utility function for adding individual cases to the selection object to return
    function addCaseToSelection( iCase) {
      selection.push( iCase);
    }

    // add each selected case from all collections to the selection object to return
    for( i=0; i<collectionCount; ++i) {
      var collection = this.getCollectionAtIndex( i),
          collSelection = collection && collection.getPath('casesController.selection');
      if( collSelection)
        collSelection.forEach( addCaseToSelection);
    }
    return selection;
  },

    /**
     * Accesses a case from its ID.
     *
     * Centralized method for Component layer objects.
     * @param iCaseID
     * @returns {DG.Case|undefined}
     */
  getCaseByID: function(iCaseID) {
    return DG.store.find( DG.Case, iCaseID);
  },


    /**
    Private properties used internally to synchronize changes with notifications.
   */
  _changeCount: 0,
  _prevChangeCount: 0,

  /**
    Returns the most-recently applied change object. Clients that observe the 'changeCount'
    property can call this function to determine what change triggered the notification.
    @property   {Object}    [computed] The most-recently applied change object
   */
  lastChange: function() {
    var count = this.changes.length;
    return count > 0 ? this.changes[ count - 1] : null;
  }.property(),
  
  /**
    Returns an array of change objects which correspond to the changes that have
    occurred since the last change notification.
    @property   {[Object]}
   */
  newChanges: function() {
    var changesLength = this.changes && this.changes.length,
        newCount = this._changeCount - this._prevChangeCount;
    DG.assert( this._changeCount <= changesLength);
    DG.assert( this._prevChangeCount <= this._changeCount);
    return this.changes.slice( changesLength - newCount);
  }.property(),
  
  /**
    Apply the specified change object to this data context.
    @param    {Object}    iChange -- An object specifying the change(s) to apply
              {String}    iChange.operation -- The name of the change to apply
                          Other change properties are operation-specific
   */
  applyChange: function( iChange) {
    iChange.result = this.performChange( iChange);
    // TODO: Figure out how/when to prune the changes array so it doesn't grow unbounded.
    this.changes.push( iChange);
    ++ this._changeCount;

    // Delay the notification until the end of the runloop, so that SproutCore has a
    // chance to flush its caches, update bindings, etc.
    this.invokeLast( function() {
                        this.set('changeCount', this._changeCount);
                        this._prevChangeCount = this._changeCount;
                      }.bind( this));
    return iChange.result;
  },
  
  /**
    Performs the specified change(s) to this data context.
    Called by the applyChange() method.
    @param    {Object}    iChange -- An object specifying the change(s) to apply
              {String}    iChange.operation -- The name of the change to apply
                          Other change properties are operation-specific
   */
  performChange: function( iChange) {
    // If the client indicates that the action has already
    // been taken, simply return with success.
    if( iChange.isComplete) return { success: true };

    var result = { success: false },
        shouldDirtyDoc = true;
    switch( iChange.operation) {
      case 'createCollection':
        result = this.doCreateCollection( iChange);
        break;
      case 'createCase':
        // doCreateCases() takes an array of values arrays
        iChange.values = [ iChange.values || [] ];
        result = this.doCreateCases( iChange);
        if( result.caseIDs && result.caseIDs.length)
          result.caseID = result.caseIDs[0];
        break;
      case 'createCases':
        result = this.doCreateCases( iChange);
        break;
      case 'updateCases':
        result = this.doUpdateCases( iChange);
        break;
      case 'deleteCases':
        result = this.doDeleteCases( iChange);
        shouldDirtyDoc = false;
        break;
      case 'selectCases':
        result = this.doSelectCases( iChange);
        shouldDirtyDoc = false;
        break;
      case 'createAttributes':
        result = this.doCreateAttributes( iChange);
        break;
      case 'updateAttributes':
        result = this.doUpdateAttributes( iChange);
        break;
      case 'deleteAttributes':
        result = this.doDeleteAttributes( iChange);
        break;
      case 'resetCollections':
        result = this.doResetCollections( iChange );
        break;
      default:
        DG.logWarn('DataContext.performChange: unknown operation: '
            + iChange.operation);
    }
    if( shouldDirtyDoc)
      DG.dirtyCurrentDocument(this.get('model'));
    return result;
  },

  /**
    Creates a collection according to the arguments specified.
    @param  {{operation:String, properties: Object, attributes: [DG.Attribute]}} iChange
                                    iChange.operation -- 'createCollection'
                                    iChange.properties -- properties of the new collection
                                    iChange.attributes -- array of attribute specifications
    @returns  {{success: boolean, collection: DG.CollectionClient}} a result object
                                    result.success -- true on success, false on failure
                                    result.collection -- the newly created collection
   */
  doCreateCollection: function( iChange) {
    function assembleInheritedAttributes(parentCollection) {
      var parentAttributes = [];
      parentCollection.forEachAttribute(function (attribute) {
        var props = attribute.toArchive();
        delete props.guid;
        parentAttributes.push(props);
      });
      return parentAttributes;
    }
    var tCollection = this.guaranteeCollection( iChange.properties),
      tParentID = tCollection.getParentCollectionID(),
      attributes = iChange.attributes;
    if (tCollection) {
      if (!SC.none(tParentID)) {
        attributes = assembleInheritedAttributes(
          this.getCollectionByID(tParentID), tCollection).concat(attributes);
      }
      attributes.forEach( function( iAttrSpec) {
                            tCollection.guaranteeAttribute( iAttrSpec);
                          });
      // if the collection has a root collection, append the parent attributes
      // if this is a recreation of the collection make sure the ordering corresponds
      // to DI expectations.
      tCollection.reorderAttributes(attributes.getEach('name'));
      return { success: true, collection: tCollection };
    }
    return { success: false, collection: null };
  },
  
  /**
    Creates a case according to the arguments specified.
    @param  {Object}                iChange
            {String}                iChange.operation -- 'createCase'
            {DG.CollectionClient}   iChange.collection (optional) -- collection containing cases
                                    If not present, the case will be created in the child collection.
            {Array of               iChange.values -- The array of values to use for the case values.
             Arrays of Values}
                                    The order of the values should match the order of the attributes
                                    in the collection specification (e.g. 'initGame').
    @returns  {Object}              An object is returned
              {Boolean}             result.success -- true on success, false on failure
              {Number}              result.caseID -- the case ID of the newly created case
   */
  doCreateCases: function( iChange) {
    /**
     * returns true if either the collection is a child collection or the parentKey
     * resolves to an existing parent.
     * @param parentKey {number}
     */
    var validateParent = function (collection, parentKey) {
      var rslt = true;
      var parentCollectionID = collection.getParentCollectionID();
      if (parentCollectionID) {
        rslt = !SC.none(this.getCaseByID(parentKey));
        if (!rslt) {
          DG.logWarn('Cannot create case with invalid or deleted parent: ' + parentKey);
        }
      }
      return rslt;
    }.bind(this);

    var createOneCase = function( iValues) {
      var newCase = collection.createCase( iChange.properties);
      if( newCase) {
        if( !SC.none( iValues)) {
          collection.setCaseValuesFromArray( newCase, parentValues.concat(iValues));
          DG.store.commitRecords();
        }
        result.success = true;
        result.caseIDs.push( newCase.get('id'));
      }
    }.bind( this);

    var collection,
        valuesArrays,
        parentIsValid = true,
        parentCase,
        parentValues = [],
        result = { success: false, caseIDs: [] };

    if( !iChange.collection) {
      iChange.collection = this.get('childCollection');
    }

    if (typeof iChange.collection === "string") {
      collection = this.getCollectionByName( iChange.collection);
    } else {
      collection = iChange.collection;
    }

    if (!iChange.properties) {
      iChange.properties = {};
    }

    if (typeof iChange.properties.parent !== 'object') {
      parentIsValid = validateParent(collection, iChange.properties.parent);
      if (iChange.properties.parent && parentIsValid) {
        parentCase = this.getCaseByID(iChange.properties.parent);
        parentCase.get('collection').getAttributeIDs().forEach(function (attributeID) {
          parentValues.push(parentCase.getValue(attributeID));
        });
      }
    }
    if( collection && parentIsValid) {
      valuesArrays = iChange.values || [ [] ];
      valuesArrays.forEach( createOneCase);
      if( result.caseIDs && (result.caseIDs.length > 0)) {
        result.caseID = result.caseIDs[0];
      }
    }
    return result;
  },
  
  /**
    Selects/deselects the specified cases.
    
    @param  {Object}                iChange
            {String}                iChange.operation -- 'selectCases'
            {DG.CollectionClient}   iChange.collection (optional) -- collection containing cases
                                    If not present, collection will be looked up from cases,
                                    which is less efficient but more flexible.
            {Array of DG.Case}      iChange.cases (optional)-- DG.Case objects to be changed
                                    If not present, all cases in collection will be changed.
            {Boolean}               iChange.select -- true for selection, false for deselection
            {Boolean}               iChange.extend -- true to extend the current selection
   */
  doSelectCases: function( iChange) {
    var tCollection = iChange.collection || this.get('childCollection'),
        tController = tCollection && tCollection.get('casesController'),
        tExtend = iChange.extend || false,
        tCollectionExtendMap = {},
      tCollectionSelectionMap = {},
        isSelectionChanged = false,
        this_ = this;
    
    // First selection change for each collection should respect iChange.extend.
    // Subsequent changes for each collection should always extend, otherwise
    // they wipe out any selection done previously.
    function extendForCollection( iCollection) {
      var collectionID = iCollection.get('id').toString();
      if( tCollectionExtendMap[ collectionID] === undefined) {
        tCollectionExtendMap[ collectionID] = true;
        return tExtend;
      }
      // After the first one, always return true
      return true;
    }

    function addSelectionToCollectionMap(iCollection, iCase) {
      var collectionID = iCollection.get('id').toString();
      if( tCollectionSelectionMap[ collectionID ] === undefined) {
        tCollectionSelectionMap[ collectionID ] = {collection:iCollection, cases: []};
      }
      tCollectionSelectionMap[ collectionID].cases.push(iCase);
    }

    function doSelectByCollection() {
      DG.ObjectMap.forEach(tCollectionSelectionMap, function (iCollectionID, iCaseMap) {
        var tCollection = iCaseMap.collection,
          tCases = iCaseMap.cases,
          tController = tCollection.get('casesController');
        tController.selectObjects( tCases, extendForCollection( tCollection));
      });
    }

    function doDeselectByCollection() {
      DG.ObjectMap.forEach(tCollectionSelectionMap, function (iCollectionID, iCaseMap) {
        var tCollection = iCaseMap.collection,
          tCases = iCaseMap.cases,
            tController = tCollection.get('casesController');
        tController.deselectObjects( tCases);
      });
    }

    // utility function for recursively selecting a case and its children
    function selectCaseAndChildren( iCase) {
      var tChildren = iCase.get('children'),
          tCollection = this_.getCollectionForCase( iCase),
          tController = tCollection && tCollection.get('casesController');
      if( tController) {
        var tSelection = tController.get('selection');
        if( tSelection && (!tSelection.contains( iCase) || (tSelection.length() > 1)))
          isSelectionChanged = true;
        //tController.selectObject( iCase, extendForCollection( tCollection));
        addSelectionToCollectionMap(tCollection, iCase);
        tChildren.forEach( selectCaseAndChildren);
      }
    }
    
    // utility function for recursively deselecting a case and its children
    function deselectCaseAndChildren( iCase) {
      var tChildren = iCase.get('children'),
          tCollection = this_.getCollectionForCase( iCase),
          tController = tCollection && tCollection.get('casesController');
      if( tController) {
        var tSelection = tController.get('selection');
        if( tSelection && tSelection.contains( iCase))
          isSelectionChanged = true;
        //tController.deselectObject( iCase);
        addSelectionToCollectionMap(tCollection, iCase);
        tChildren.forEach( deselectCaseAndChildren);
      }
    }
    
        // If cases aren't specified, assume select/deselect all
    var tCases = iChange.cases || tController,
        // Use the appropriate utility function for the job
        tFunction = iChange.select ? selectCaseAndChildren : deselectCaseAndChildren;
    
    // Apply the appropriate function to the specified cases
    if( tCases && tFunction) {
      tCases.forEach( tFunction);
      if (iChange.select) {
        doSelectByCollection();
      } else {
        doDeselectByCollection();
      }
    }
    
    // If we are only selecting cases in child collection(s), we should
    // deselect any parent level cases when we're not extending.
    // Note that the current behavior is to always deselect all cases in
    // a parent collection after changing the selection in a child collection.
    // This is less ambitious than full synchronization, whereby individually
    // selecting all of the child cases of a single parent collection could
    // auto-select the parent collection as well (or vice-versa).
    if( isSelectionChanged) {
      this.forEachCollection( function( iCollectionClient) {
                                var collectionID = iCollectionClient.get('id'),
                                    tController = iCollectionClient.get('casesController');
                                if( collectionID && tController &&
                                    !extendForCollection( iCollectionClient)) {
                                  tController.selectObject(); // deselect all
                                }
                              });
      this.incrementProperty( 'selectionChangeCount');
    }
    
    return { success: true };
  },
  
  /**
    Changes the specified values of the specified cases.
    
    @param  {Object}                iChange
            {String}                iChange.operation -- 'updateCases'
            {DG.CollectionClient}   iChange.collection (optional) -- collection containing cases
                                    If not present, collection will be looked up from case,
                                    which is less efficient but more flexible.
            {Array of Number}       iChange.attributeIDs (optional) -- attributes whose values
                                    are to be changed for each case.
                                    If not specified, all attributes are changed.
            {Array of DG.Case}      iChange.cases -- DG.Case objects to be changed
            {Array of Array of      If attributeIDs are specified, then the values are stored in
                      values}       attribute-major fashion, i.e. there is an array of values for
                                    each attribute with a value for each case in each of the arrays.
                                    If attributeIDs are not specified, then the values are stored in
                                    case-major fashion, with an array of values for each case.
                                    The latter is used primarily for case creation using the Game API.
   */
  doUpdateCases: function( iChange) {
    var caseCount = iChange.cases.get('length'),
        attrCount = iChange.attributeIDs ? iChange.attributeIDs.get('length') : 0,
        valueArrayCount = iChange.values.get('length'),
        attrSpecs = [],
        childCollection = this.getChildCollection(iChange.collection),
        childAttrSpecs = [],
        a, c;

    iChange.caseIDs = [];
    // If no attributes were specified, set them all using setCaseValuesFromArray().
    // This is primarily used by the Game API to set all values of a case.
    if( (caseCount > 0) && (attrCount === 0) && (valueArrayCount > 0)) {
      iChange.cases.forEach( function( iCase, iIndex) {
        var caseIDs;
          if( iCase && !iCase.get('isDestroyed')) {
            caseIDs = this.setCaseValuesFromArray( iCase, iChange.values[ iIndex], iChange.collection);
            if (caseIDs.length > 0) {
              Array.prototype.push.apply(iChange.caseIDs, caseIDs);
            }
          }
      }.bind( this));
    } else {
      // If attributes are specified, set the values individually.
      // Look up the attributes
      iChange.attributeIDs.forEach(function (attrID) {
        var attrSpec = this.getAttrRefByID( attrID);
        attrSpec.attributeID = attrID;
        attrSpecs.push( attrSpec);
      });
      if (childCollection) {
        iChange.attributeIDs.forEach(function (attrID) {
          var attrSpec = this.getAttrRefByID( attrID),
            attrName = attrSpec.name,
            childAttrSpec = childCollection.getAttributeByName(attrName);
          childAttrSpecs.push( childAttrSpec);
        }.bind(this));
      }

      // Loop through the cases
      for( c = 0; c < caseCount; ++c) {
        var tCase = iChange.cases.objectAt( c);
        iChange.caseIDs.push( tCase.get('id'));
        // Change the case values
        tCase.beginCaseValueChanges();
        // Loop through the attributes setting each value
        for( a = 0; a < attrCount; ++a) {
          tCase.setValue( attrSpecs[a].attributeID, iChange.values[a][c]);
          if (tCase.children) {
            tCase.children.forEach(function (child) {
              iChange.casesIDs.push(child.get('id'));
              child.setValue( childAttrSpecs[a].attributeID, iChange.values[a][c]);
            });
          }
        }
        tCase.endCaseValueChanges();
      }
    }
    // If we have a child collection, then we would have modified this, so
    // we cause listeners to invalidate everything.
    if (childCollection) { delete iChange.cases; }
    return { success: true };
  },

  /**
    Deletes the specified cases along with any child cases.
    @param  {Object}                iChange
            {String}                iChange.operation -- 'deleteCases'
            {Array of DG.Case}      iChange.cases -- DG.Case objects to be deleted
            {Array of Number}       iChange.ids -- on output, the IDs of the deleted cases
   */
  doDeleteCases: function( iChange) {
    var deletedCases = [],
        oldCaseToNewCaseMap = {},
        this_ = this;

    iChange.ids = [];
    iChange.collectionIDs = {};
  
    var deleteCaseAndChildren = function( iCase) {
      if (iCase.get("isDestroyed"))
        // case has already been destroyed. (Happens when we select parents and children and delete all)
        return;

      var tChildren= iCase.get('children'), ix;
      // we remove children in reverse order because removal from this list
      // is immediate and would otherwise corrupt the list.
      if( tChildren && tChildren.length) {
        for (ix = tChildren.length - 1; ix >= 0; ix--) {
          deleteCaseAndChildren(tChildren[ix]);
        }
      }

      iChange.ids.push( iCase.get('id'));
      
      var tCollection = this.getCollectionForCase( iCase);

      // We store the set of deleted cases for later undoing.
      // We need to store the values separately, because when iCase.destroy is called
      // on the case, the values map is deleted
      // We also store the original index separately
      deletedCases.push( {
        oldCase: iCase,
        values: iCase._valuesMap,
        index: iCase.collection.caseIDToIndexMap[iCase.get("id")]
      });

      tCollection.deleteCase( iCase);
      // keep track of the affected collections
      iChange.collectionIDs[ tCollection.get('id')] = tCollection;
    }.bind( this);

    DG.UndoHistory.execute(DG.Command.create({
      name: "data.deleteCases",
      undoString: 'DG.Undo.data.deleteCases',
      redoString: 'DG.Redo.data.deleteCases',
      execute: function() {
        // Delete each case
        iChange.cases.forEach( deleteCaseAndChildren);

        // Call didDeleteCases() for each affected collection
        DG.ObjectMap.forEach( iChange.collectionIDs, function( iCollectionID, iCollection) {
          if( iCollection)
            iCollection.didDeleteCases();
        });

        // Store the set of deleted cases, along with their values
        this._undoData = deletedCases;

        DG.dirtyCurrentDocument();
      },
      undo: function() {
        for (var i = this._undoData.length - 1; i >= 0; i--) {
          var oldCase       = this._undoData[i].oldCase,
              oldValuesMap  = this._undoData[i].values,
              oldIndex      = this._undoData[i].index,
              oldCollection = this_.getCollectionForCase(oldCase),
              parent        = oldCase.parent,
              values        = [],
              iChange, result;

          // Case-creation expects an array of values, which later gets changed into a map.
          // We need to go backwards to make an array from the original case's map
          DG.ObjectMap.forEach( oldValuesMap, function( id, value) {
            values.push(value);
          });

          // If we have deleted and then re-created the parent, we need to find the new one
          if (parent && oldCaseToNewCaseMap[parent]) {
            parent = oldCaseToNewCaseMap[parent];
          }

          // Create the change object that will re-insert a new case identical to the old deleted case
          iChange = {
            operation: "createCase",
            properties: {
              collection: oldCase.collection,
              parent: parent,
              index: oldIndex
            },
            values: values,
            collection: oldCollection

          };

          // We need to go all the way back to the applyChange method, instead of shortcutting to
          // the doCreateCases method, in order to trigger all the necessary observers
          result = this_.applyChange( iChange);
          if (oldCollection.collection) {
            var cases = oldCollection.collection.casesRecords.filterProperty("id", result.caseID);
            if (cases.length) {
              oldCaseToNewCaseMap[oldCase.toString()] = cases[0];
            }
          }
        }

        DG.dirtyCurrentDocument();
      },
      redo: function() {
        // create a new change object, based on the old one, without modifying
        // the old change object (in case we undo and redo again later)
        var newChange = SC.clone(iChange);
        newChange.cases = iChange.cases.slice();
        newChange.ids.length = 0;
        delete newChange.result;

        // find the new cases that were created by undo, and delete those (the originals are gone)
        for (var i = 0; i < iChange.cases.length; i++) {
          if (oldCaseToNewCaseMap[iChange.cases[i]]) {
            newChange.cases[i] = oldCaseToNewCaseMap[iChange.cases[i]];
          }
        }
        this_.applyChange( newChange);
      }
    }));

    return { success: true };
  },
  
  doCreateAttributes: function( iChange) {
    var collection = typeof iChange.collection === "string"
                        ? this.getCollectionByName( iChange.collection)
                        : iChange.collection,
        didCreateAttribute = false,
        result = { success: false, attrs: [], attrIDs: [] };
    
    // Create/update the specified attribute
    function createAttribute( iAttrProps) {
      var hadAttribute = collection.hasAttribute( iAttrProps.name),
          attrProps = DG.copy( iAttrProps),
          attribute;
      // User-created attributes default to editable
      if( !hadAttribute)
        attrProps.editable = true;
      attribute = collection.guaranteeAttribute( attrProps);
      if( attribute) {
        if( !hadAttribute)
          didCreateAttribute = true;
        // For now, return success if any attribute is created successfully
        result.success = true;
        result.attrs.push( attribute);
        result.attrIDs.push( attribute.get('id'));
      }
    }
    
    // Create/update each specified attribute
    if( collection && iChange.attrPropsArray)
      iChange.attrPropsArray.forEach( createAttribute);
    // For now we assume success
    if( !didCreateAttribute)
      iChange.operation = 'updateAttributes';
    return result;
  },

  /**
    Updates the specified properties of the specified attributes.
    @param  {Object}    iChange - The change request object
              {String}  .operation - "updateCases"
              {DG.CollectionClient} .collection - Collection whose attributes(s) are changed
              {Array of Object} .attrPropsArray - Array of attribute properties
    @returns  {Object}
                {Boolean}               .success
                {Array of DG.Attribute} .attrs
                {Array of Number}       .attrIDs
   */
  doUpdateAttributes: function( iChange) {
    var collection = typeof iChange.collection === "string"
                        ? this.getCollectionByName( iChange.collection)
                        : iChange.collection,
        result = { success: false, attrs: [], attrIDs: [] };
    
    // Function to update each individual attribute
    function updateAttribute( iAttrProps) {
      // Look up the attribute by ID if one is specified
      var attribute = collection && !SC.none( iAttrProps.id)
                        ? collection.getAttributeByID( iAttrProps.id)
                        : null;
      // Look up the attribute by name if not found by ID
      if( !attribute && collection && iAttrProps.name) {
        attribute = collection.getAttributeByName( iAttrProps.name);
      }
      if( attribute) {
        attribute.beginPropertyChanges();
        DG.ObjectMap.forEach( iAttrProps,
                              function( iKey, iValue) {
                                if( iKey !== "id") {
                                  attribute.set( iKey, iValue);
                                }
                              });
        attribute.endPropertyChanges();
        result.success = true;
        result.attrs.push( attribute);
        result.attrIDs.push( attribute.get('id'));
      }
    }
    
    // Create/update each specified attribute
    if( collection && iChange.attrPropsArray)
      iChange.attrPropsArray.forEach( updateAttribute);
    return result;
  },
  
  /**
    Deletes the specified attributes.
    @param  {Object}    iChange - The change request object
              {String}  .operation - "deleteAttributes"
              {DG.CollectionClient} .collection - Collection whose attributes(s) are changed
              {Array of Object} .attrs - Array of attributes to delete
    @returns  {Object}
                {Boolean}               .success
                {Array of DG.Attribute} .attrs
                {Array of Number}       .attrIDs
   */
  doDeleteAttributes: function( iChange) {
    var collection = typeof iChange.collection === "string"
                        ? this.getCollectionByName( iChange.collection)
                        : iChange.collection,
        result = { success: false, attrIDs: [] };
    
    // Function to delete each individual attribute
    function deleteAttribute( iAttr) {
      // Look up the attribute by ID if one is specified
      var attribute = collection && !SC.none( iAttr.id)
                        ? collection.getAttributeByID( iAttr.id)
                        : null;
      if( attribute) {
        DG.Attribute.destroyAttribute( iAttr.attribute);
        result.attrIDs.push( iAttr.id);
      }
    }
    
    // Create/update each specified attribute
    if( collection && iChange.attrs) {
      iChange.attrs.forEach( deleteAttribute);
      DG.store.commitRecords();
    }
    return result;
  },

  doResetCollections: function (iChange) {
      DG.DataContext.clearContextMap();
//      DG.store.destroyAllRecordsOfType( DG.GlobalValue);
      DG.store.destroyAllRecordsOfType( DG.Case);
      DG.store.destroyAllRecordsOfType( DG.Attribute);
      DG.store.destroyAllRecordsOfType( DG.CollectionRecord);
//      DG.store.destroyAllRecordsOfType( DG.DataContextRecord);
  },
  
  /**
   * Export the case data for all attributes and cases of the given collection,
   * suitable for pasting into TinkerPlots/Fathom.
   * If no collection name given, returns an list of collection names.
   * @param {String} iWhichCollection '' or 'parent' or 'child' or 'parent+child' [both for flatted collection with all attributes]
   * @return {String} Case data in tab-delimited string format | list of collection names that can be exported (comma-separated string)
   */
  exportCaseData: function( iWhichCollection ) {
    var childCollection = this.get('childCollection'),
        parentCollection = this.get('parentCollection'),
        childName = childCollection && childCollection.get('name'),
        parentName = parentCollection && parentCollection.get('name'),
        bothName = (parentName + '+' + childName ),
        names = [],
        columnDelimiter = '\t',
        rowDelimiter = '\r\n';

    //DG.assert( childCollection && parentCollection, "exportCaseData collections not found");
    //if( !( childCollection && parentCollection )) return('');

    if( SC.empty( iWhichCollection )) {
      if (parentName) {names.push(parentName);}
      if (childName) {names.push(childName);}
      if (parentName && childName) {names.push(bothName);}
      // return collection names as an array
      return names.join(columnDelimiter);
    }

    // else create a tab and newline delimited string of attribute names and case values.
    var collection = ((iWhichCollection===parentName) ? parentCollection : childCollection ),
        extraCollection = ((iWhichCollection===bothName)? parentCollection : null),
        attribNames = collection && collection.getAttributeNames(),
        attribIDs   = collection && collection.getAttributeIDs(),
        dataString;

    // if 'both', prepend parent attributes for flattened data set
    //  Note: we rely on DG.CaseModel.getValues() to get values for parent attribute IDs
    if( extraCollection ){
      attribNames = extraCollection.getAttributeNames().concat( attribNames );
      attribIDs = extraCollection.getAttributeIDs().concat( attribIDs );
    }

    // add a row of attribute names
    dataString = attribNames.join(columnDelimiter) + rowDelimiter;

    // add each row of case values
    collection.forEachCase( function( iCase, iIndex ) {
      var rowString = '';
      attribIDs.forEach( function( iAttrID ) {
        var caseValue = iCase.getValue( iAttrID);
        if( rowString.length > 0 )  rowString += columnDelimiter; // separate items with tabs
        if( !SC.empty( caseValue )) rowString += caseValue.toString(); // add string value if not a missing case
      });
      dataString += rowString + rowDelimiter; // append each line of data to the output
    });

    return dataString;
  },
  
  /**
   *  The number of collections controlled by this controller.
   *  @property {Number}
   */
  collectionCount: function() {
    return this.getPath('collections.length') || 0;
  }.property(),
  
  /**
   *  Returns the DG.CollectionClient for the child or leaf collection.
   *  @returns  {DG.CollectionClient | null}
   */
  childCollection: function() {
    var collectionCount = this.get('collectionCount');
    return( collectionCount ? this.getCollectionAtIndex( collectionCount - 1) : null);
  }.property('_collectionClients','_collectionClients.[]'),
  
  /**
   *  Returns the DG.CollectionClient for parent collection of the child or leaf collection.
   *  @returns  {DG.CollectionClient | null}
   */
  parentCollection: function() {
    var collectionCount = this.get('collectionCount');
    return( collectionCount ? this.getCollectionAtIndex( collectionCount - 2) : null);
  }.property('_collectionClients','_collectionClients.[]'),
  
  /**
   *  Returns the DG.CollectionClient at the specified index.
   *  Since collections are stored in parent --> child order,
   *  index 0 corresponds to the oldest ancestor, while the last index
   *  corresponds to the child/leaf collection.
   *  @returns  {DG.CollectionClient | undefined}
   */
  getCollectionAtIndex: function( iIndex) {
    var collections = this.get('collections'),
        collectionCount = this.get('collectionCount'),
        collection = (collections && (collectionCount > iIndex) &&
                            collections.objectAt( iIndex)) || null;
    return collection && this._collectionClients[ collection.get('id')];
  },
  
  /**
   *  Returns the DG.CollectionClient with the specified name.
   *  Searches its collections from child => parent => grandparent order.
   *  @returns  {DG.CollectionClient | null}
   */
  getCollectionByName: function( iName) {
    var collectionCount = this.get('collectionCount'),
        collections = this.get('collections'),
        collection;
    for( var i = 0; i < collectionCount; ++i) {
      collection = collections.objectAt(i);
      if (collection && (collection.get('name') === iName)) {
        return this._collectionClients[ collection.get('id')];
      }
    }
    return null;
  },
  
  /**
   *  Returns the DG.CollectionClient with the specified ID.
   *  @param    {Number}  iCollectionID -- The ID of the DG.collection
   *  @returns  {DG.CollectionClient | null}
   */
  getCollectionByID: function( iCollectionID) {
    return this._collectionClients[ iCollectionID] || null;
  },
  
  /**
    Returns the collection (DG.CollectionClient) which contains the specified case (DG.Case).
    @param    {DG.Case}               iCase -- The case whose collection is to be returned
    @returns  {DG.CollectionClient}   The collection which contains the specified case
   */
  getCollectionForCase: function( iCase) {
    return this.getCollectionByID( iCase.getPath('collection.id'));
  },
  
  /**
    Returns the collection (DG.CollectionClient) which contains
    the specified attribute (DG.Attribute).
    @param    {DG.Attribute}          iAttribute -- The attribute whose collection is to be returned
    @returns  {DG.CollectionClient}   The collection which contains the specified case
   */
  getCollectionForAttribute: function( iAttribute) {
    return this.getCollectionByID( iAttribute.getPath('collection.id'));
  },
  
  /**
    Returns the parent collection, if any, for the specified collection.
    Returns null if the specified collection has no parent collection.
    @param    {DG.CollectionClient}   iCollection -- The (child) collection whose parent is sought
    @returns  {DG.CollectionClient}   The parent collection (if one exists) or null
   */
  getParentCollection: function( iCollection) {
    var childCollectionID = iCollection && iCollection.get('id'),
        collectionCount = this.get('collectionCount'),
        collections = this.get('collections'),
        collection, collectionID,
        prevCollectionID = null;
    for( var i = 0; i < collectionCount; ++i) {
      collection = collections.objectAt( i);
      collectionID = collection.get('id');
      if( collection && (collectionID === childCollectionID))
        return this.getCollectionByID( prevCollectionID);
      prevCollectionID = collectionID;
    }
    return null;
  },

  /**
   Returns the child collection, if any, for the specified collection.
   Returns null if the specified collection has no child collection.
   @param    {DG.CollectionClient}   iCollection -- The (parent) collection whose parent is sought
   @returns  {DG.CollectionClient}   The child collection (if one exists) or null
   */
  getChildCollection: function( iCollection) {
    var childCollectionID = iCollection && iCollection.get('id'),
        collectionCount = this.get('collectionCount'),
        collections = this.get('collections'),
        collection, collectionID,
        prevCollectionID = null;
    for( var i = collectionCount-1; i >= 0; --i) {
      collection = collections.objectAt( i);
      collectionID = collection.get('id');
      if( collection && (collectionID === childCollectionID))
        return this.getCollectionByID( prevCollectionID);
      prevCollectionID = collectionID;
    }
    return null;
  },
  
  /**
    Creates a collection with the specified initial properties.
    @param    {Object}              iProperties -- The initial properties for the newly-created object
    @returns  {DG.CollectionClient} The newly-created collection
   */
  createCollection: function( iProperties) {
    var //newCollection = this.get('model').createCollection( iProperties || {}),
      tProperties = iProperties || {},
        newCollectionClient;

    tProperties.context = this.get('model');
    newCollectionClient = this.addCollection( DG.Collection.createCollection(tProperties));
    this.didCreateCollection( newCollectionClient);
    return newCollectionClient;
  },

  /**
    Called from createCollection to give derived classes a chance to do something.
    @param  {DG.CollectionClient} iNewCollection -- The collection that was just created
   */
  didCreateCollection: function( iNewCollection) {
    // derived classes may override
  },
  
  /**
    Returns a collection matching the specified properties, creating it if necessary.
    @param    {Object}    iCollectionProperties -- Properties to match or to use as initial
                                                   values if the collection must be created.
    @returns  {DG.CollectionClient}   That matched or newly-created collection
   */
  guaranteeCollection: function( iCollectionProperties) {
    var aCollectionClient = this.getCollectionByName( iCollectionProperties.name);
    if (!aCollectionClient)
      aCollectionClient = this.createCollection( iCollectionProperties);
    return aCollectionClient;
  },

  /**
    Creates and connects a DG.Collection model and DG.CollectionClient controller for the
    specified DG.Collection.
    @param    {DG.Collection || DG.Collection}   iCollection -- The collection record to create the
                                                           model and controller for.
    @returns  {DG.CollectionClient}   The newly-created collection client
   */
  addCollection: function( iCollection) {
    function getCollection(iCollectionRecord) {
      DG.logWarn('Instantiating collection from collectionRecord');
      return DG.Collection.create({ collectionRecord: iCollectionRecord });
    }
    var theID = iCollection && iCollection.get('id'),
        theCollection = (theID && (iCollection.type === 'DG.CollectionRecord'))
          ? getCollection(iCollection)
          : iCollection,
        theCollectionClient = theCollection && DG.CollectionClient.create({});
    if (theCollectionClient && theCollection && theID) {
      theCollectionClient.setTargetCollection(theCollection);
      this._collectionClients[ theID ] = theCollectionClient;
      this.didAddCollection( theCollectionClient );
    }
    return theCollectionClient;
  },
  
  /**
    Utility function for adding observers for formula change notifications
    from individual collections.
    @param    {DG.CollectionClient}   iCollection -- The collection that was added
   */
  didAddCollection: function( iCollection) {
    iCollection.addObserver('attrFormulaChanges', this, 'attrFormulaDidChange');
  },
  
  /**
    Utility function for removing observers for formula change notifications
    from individual collections.
    @param    {DG.CollectionClient}   iCollection -- The collection that will be removed
   */
  willRemoveCollection: function( iCollection) {
    iCollection.removeObserver('attrFormulaChanges', this, 'attrFormulaDidChange');
  },
  
  /**
    The observer/handler for attribute formula change notifications from collections.
    Notifies clients with an 'updateCases' notification. Note that we don't currently
    include attribute-specific information in the notification, so clients can't make
    attribute-specific responses. To support those, the collection would have to include
    attribute-specific information in its notification, which this method would then
    propagate to its observers in some fashion.
   */
  attrFormulaDidChange: function( iNotifier) {
    var change = {
          operation: 'updateCases',
          collection: iNotifier,
          isComplete: true
        };
    this.applyChange( change);
  },
  
  /**
    Applies the specified function to each collection managed by this data context.
    @param    {Function}        The function to apply to each collection
    @returns  {DG.DataContext}  this, for use in method chaining
   */
  forEachCollection: function( iFunction) {
    var this_ = this,
        collections = this.get('collections');
    collections.
      forEach( function( iCollection) {
                var collectionID = iCollection.get('id'),
                    collectionClient = this_.getCollectionByID( collectionID);
                if( collectionClient)
                  iFunction( collectionClient);
              });
    return this;
  },
  
  /**
    Returns the string that best represents the noun form of the specified number of cases,
    e.g. "case"|"cases", "person"|"people", "deer"|"deer", "goose"|"geese", etc.
    @param    {DG.CollectionClient} iCollectionClient -- The collection whose labels are returned
    @param    {Number}              iCount -- The number of cases to represent
    @returns  {String}              The string to represent the specified number of cases
   */
  getCaseNameForCount: function( iCollectionClient, iCount) {
    var tCollection = iCollectionClient.get('collection'),
        tLabels = tCollection && tCollection.get('labels'),
        tSingName = tLabels ? tLabels.singleCase : tCollection.get('caseName'),
        tPluralName = tLabels ? tLabels.pluralCase : tCollection.get('name');
    tSingName = tSingName || 'DG.DataContext.singleCaseName'.loc();
    tPluralName = tPluralName || 'DG.DataContext.pluralCaseName'.loc();
    return (iCount === 1) ? tSingName : tPluralName;
  },
  
  /**
    Returns a case count string indicating the number of cases using the appropriate
    case name, e.g. "1 case"|"2 cases", "1 person"|"2 people", etc.
    @param    {DG.CollectionClient} iCollection -- The collection whose labels are returned
    @param    {Number}              iCount -- The number of cases to represent
    @returns  {String}              The string to represent the specified number of cases
   */
  getCaseCountString: function( iCollection, iCount) {
    var caseName = this.getCaseNameForCount( iCollection, iCount);
    return 'DG.DataContext.caseCountString'.loc( iCount, caseName);
  },
  
  /**
    Returns the string that represents a coherent set of cases, e.g. a set of Lunar Lander
    events is often called "a flight record", while in other games it might be "a round".
    @param    {DG.CollectionClient} iCollection -- The collection whose labels are returned
    @returns  {String}              The string label to represent a set of cases
   */
  getLabelForSetOfCases: function( iCollection) {
    return iCollection.getPath('collection.collection.parent.caseName') ||
        'DG.DataContext.setOfCasesLabel'.loc();
  },
  
  /**
   *  Returns a specification for the DG.Attribute with the specified ID.
   *  Searches its collections from child => parent => grandparent order.
   *  @param    {Number}        iAttributeID -- the ID of the attribute to be returned
   *  @returns  {Object | null} Object.collection:  {DG.CollectionClient}
   *                            Object.attribute:   {DG.Attribute}
   */
  getAttrRefByID: function( iAttributeID) {
    var collectionCount = this.get('collectionCount'),
        collections = this.get('collections');
    for( var i = collectionCount - 1; i >= 0; --i) {
      var collection = collections.objectAt( i),
          collectionClient = collection && this._collectionClients[ collection.get('id')],
          foundAttr = collectionClient && collectionClient.getAttributeByID( iAttributeID);
      if( foundAttr)
        return { collection: collectionClient, attribute: foundAttr };
    }
    return null;
  },
  
  /**
   *  Returns a specification for the DG.Attribute with the specified name.
   *  Searches its collections from child => parent => grandparent order.
   *  @param    {String}        iName -- the name of the attribute to be returned
   *  @returns  {Object | null} Object.collection:  {DG.CollectionClient}
   *                            Object.attribute:   {DG.Attribute}
   */
  getAttrRefByName: function( iName) {
    var collectionCount = this.get('collectionCount'),
        collections = this.get('collections');
    for( var i = collectionCount - 1; i >= 0; --i) {
      var collection = collections.objectAt( i),
          collectionClient = collection && this._collectionClients[ collection.get('id')],
          foundAttr = collectionClient && collectionClient.getAttributeByName( iName);
      if( foundAttr)
        return { collection: collectionClient, attribute: foundAttr };
    }
    return null;
  },
  
  /**
   *  Returns the DG.Attribute with the specified name.
   *  Searches its collections from child => parent => grandparent order.
   *  @returns  {DG.Attribute | null}
   */
  getAttributeByName: function( iName) {
    var attrRef = this.getAttrRefByName( iName);
    return attrRef ? attrRef.attribute : null;
  },
  
  /**
    Sets the values of the specified case from the specified array of values.
    @param  {DG.Case}       iCase     The case whose values are to be set
    @param  {[values]}      iValues   The values to use in setting the case values
    @param  {DG.CollectionClient} iCollection (optional) -- The collection which owns the case.
              Will be looked up if it isn't provided, but more efficient if the client provides it.
    @return {[number]}      array of affected case ids.
   */
  setCaseValuesFromArray: function( iCase, iValues, iCollection) {
    var caseIDs = [];
    var collection = iCollection || this.getCollectionForCase( iCase);
    var childCollection = this.getChildCollection(collection);
    if( collection) {
      collection.setCaseValuesFromArray( iCase, iValues);
      caseIDs.push(iCase.id);
      if (iCase.children && iCase.children.length>0) {
        iCase.children.forEach(function (child) {
          if (childCollection) {
            caseIDs.push(child.id);
            childCollection.setCaseValuesFromArray(child, iValues);
          }
        });
      }
    }
    return caseIDs;
  },
  
  /**
    Returns an object which specifies the default collections for this data context along
    with some of the default properties of that collection, e.g. default attributes to plot.
    @returns    {Object}    An object specifying the defaults
                {DG.CollectionClient}   object.collectionClient -- child collection
                {DG.CollectionClient}   object.parentCollectionClient -- parent collection
                {String}                object.plotXAttr -- default X attribute on graphs
                {String}                object.plotYAttr -- default Y attribute on graphs
   */
  collectionDefaults: function() {

    return {
      collectionClient: this.get('childCollection'),
      parentCollectionClient: this.get('parentCollection'),
      plotXAttr: null,
      plotXAttrIsNumeric: true,
      plotYAttr: null,
      plotYAttrIsNumeric: true
    };
  },
  
  /**
    Called by the framework as part of the document writing process, to give
    DG.DataContext derived classes a chance to write out context-specific information.
    Clients should implement/override the createStorage() method rather than
    overriding this function.
   */
  willSaveContext: function() {
    var model = this.get('model');
    if( model) {
      var contextStorage = this.createStorage() || {};
      model.set('contextStorage', contextStorage);
    }
  },
  
  /**
    Returns a link object of the form { type: 'DG.DataContextRecord', id: contextID }.
    @returns  {Object}  linkObject -- contains the type and id of the referenced record
              {String}  linkObject.type -- the type of record ('DG.DataContextRecord' in this case).
              {Number}  linkObject.id -- the id of the data context record
   */
  toLink: function() {
    var model = this.get('model');
    return model && model.toLink();
  },
  
  /**
   *  Returns the object to be JSONified for storage.
   *  @returns  {Object}
   */
  createStorage: function() {
    return {};
  },
  
  /**
   *  Copies the contents of iComponentStorage to the model.
   *  @param {Object} iComponentStorage -- Properties restored from document.
   */
  restoreFromStorage: function( iContextStorage) {
    var collections = this.get('collections');
    if( !SC.none( collections)) {
      DG.ObjectMap.forEach(collections, function( key) {
                            this.addCollection( collections[key]);
      }.bind(this));
    }
  }
  
  }; // end return from closure
  
}())) ; // end closure

/**
 *  A registry of creation functions for use by the DG.DataContext.factory() function.
 *  Derived classes should add their own factory function entries.
 *  Clients call DG.DataContext.factory() to create a new polymorphically-typed
 *  DataContext object.
 */
DG.DataContext.registry = {};
DG.DataContext.registry['DG.DataContext'] = function( iProperties) {
                                              return DG.DataContext.create( iProperties);
                                            };

/** @private
  Map from context ID ==> DG.DataContext (or derived class).
  Note that the APIs for the contextMap take a documentID, which
  is not currently used. This is a nod to a possible future in which
  multiple documents are likely to be supported. For now, when only
  one document can be open at a time, we simplify our lives by
  ignoring the documentID and assuming that all entries in the map
  are from the same (current) document.
  @property {Object}  A map from contextID ==> context.
 TODO: Deprecate this data structure and remove references: We should be getting context
 TODO: information via the DocumentController.
 */
DG.DataContext._contextMap = {};

/**
  Clear the contents of the contextMap.
  @param  {String}  iDocumentID -- Currently unused since DG is currently single-document
 TODO: Deprecate this method and remove references: We should be getting context
 TODO: information via the DocumentController.
 */
DG.DataContext.clearContextMap = function( iDocumentID) {
  DG.DataContext._contextMap = {};
};

/**
  Store the specified context in the contextMap.
  @param  {String}  iDocumentID -- Currently unused since DG is currently single-document
  @param  {DG.DataContext}  iContext -- The context to be stored in the map
 TODO: Deprecate this method and remove references: We should be getting context
 TODO: information via the DocumentController.
 */
DG.DataContext.storeContextInMap = function( iDocumentID, iContext) {
  if( iContext) {
    var contextID = iContext.get('id');
    if( !SC.none( contextID))
      DG.DataContext._contextMap[ contextID] = iContext;
  }
};

/**
  Retrieve the specified context from the contextMap.
  @param  {String}  iDocumentID -- Currently unused since DG is currently single-document
  @param  {Number}  iContextIS -- The ID of the context to be retrieved from the map
 TODO: Deprecate this method and remove references: We should be getting context
 TODO: information via the DocumentController.
 */
DG.DataContext.retrieveContextFromMap = function( iDocumentID, iContextID) {
  return DG.DataContext._contextMap[ iContextID];
};

/**
 Returns an array of keys to known data contexts.
 @param  {String}  iDocumentID -- Currently unused since DG is currently single-document

 TODO: Deprecate this method and remove references: We should be getting context
 TODO: information via the DocumentController.
 */
DG.DataContext.contextIDs = function(iDocumentID) {
  return DG.ObjectMap.keys(DG.DataContext._contextMap);
};

/**
  Returns the context that contains the specified collection.
  Currently, this is implemented simply by following the 'context' property
  of the DG.Collection back to its DG.DataContextRecord and then looking
  up the DG.DataContext by ID. The current implementation (like most other
  functions here) ignores the document ID. Note that there is a bit of a code
  smell surrounding the use of this function. Clients that have access to a
  collection should really have access to the context as well.
  @param    {DG.CollectionClient} iCollectionClient -- The collection whose context is to be found
  @returns  {DG.DataContext}      The collection's DG.DataContext or null

 TODO: Deprecate this method and remove references: We should be getting context
 TODO: information via the DocumentController.
 */
DG.DataContext.getContextFromCollection = function( iCollectionClient) {
  var collection = iCollectionClient &&
                          iCollectionClient.get('collection'),
      contextID = collection && collection.getPath('context.id'),
      context = contextID &&
                  DG.DataContext.retrieveContextFromMap( null, contextID);
  return context;
};
/**
 Returns an object which specifies the default collections for this data context along
 with some of the default properties of that collection, e.g. default attributes to plot.
 @returns    {Object}    An object specifying the defaults
 {DG.CollectionClient}   object.collectionClient -- child collection
 {DG.CollectionClient}   object.parentCollectionClient -- parent collection
 {String}                object.plotXAttr -- default X attribute on graphs
 {String}                object.plotYAttr -- default Y attribute on graphs
 */
DG.DataContext.collectionDefaults = function() {
  var defaultValues = {
    collectionClient: null, //this.get('childCollection'),
    parentCollectionClient: null, //this.get('parentCollection'),
    plotXAttr: null,
    plotXAttrIsNumeric: true,
    plotYAttr: null,
    plotYAttrIsNumeric: true
  };
  return defaultValues;
};
/**
 *  A factory function for creating an appropriate DG.DataContext object, i.e.
 *  either a DG.DataContext or an appropriate derived class. Derived classes should
 *  add their own factory function entries to the DG.DataContext.registry, so that
 *  when this function is called the factory function will be available when appropriate.
 *  @param  {String}  type of DataContext to create, e.g. 'DG.DataContext', 'DG.GameContext'.
 *  @param  {Object}  properties object passed to the DataContext on construction.
 *  @returns  {DG.DataContext}  a DG.DataContext object or an instance of a derived class
 */
DG.DataContext.factory = function( iProperties) {
                          var type = iProperties && iProperties.type,
                              func = type && DG.DataContext.registry[type],
                              context = func ? func( iProperties) : DG.DataContext.create( iProperties);
                          if( context)
                            DG.DataContext.storeContextInMap( context.getPath('model.document.id'), context);
                          return context;
                        };

