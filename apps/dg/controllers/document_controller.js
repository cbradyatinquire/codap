// ==========================================================================
//                        DG.DocumentController
//
//  A controller for a single document.
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

/* globals jiff */
sc_require('libraries/jiff');
sc_require('libraries/es6-promise-polyfill');

/** @class

  Coordinating controller for the document.

  @extends SC.Object
*/
DG.DocumentController = SC.Object.extend(
 /** @scope DG.DocumentController.prototype */ {

    /**
     *  The document managed by this controller.
     *  @property {DG.Document}
     */
    content: null,

    /**
     *  The DataContexts which are managed by this controller.
     *  Bound to the document's 'contexts' property.
     *  @property {Array of DG.DataContextRecord}
     */
    contextRecords: function() {
      return this.getPath('content.contexts');
    }.property(),

      contexts: null,

    /**
     *  The Components which are managed by this controller.
     *  Bound to the document's 'components' property.
     *  @property {Object} Hashmap of Components
     */
    components: function() {
      return this.getPath('content.components');
    }.property(),

      /**
       * Returns an array of the GameControllers defined in this document.
       */
      dataInteractives: function() {
        var componentControllers = this.get('componentControllersMap'),
          result = [];
        if (componentControllers) {
          DG.ObjectMap.forEach(componentControllers, function (key, component) {
            var type = component.getPath('model.type');
            if (type === 'DG.GameView') {
              result.push(component);
            }
          });
        }
        return result;
      }.property('componentControllersMap'),
    /**
      Map from component ID to the component's controller
     */
    componentControllersMap: null,

    /** @private
      Maintain links to singleton component views
     */
    _singletonViews: null,

      /**
       * The state of the document. The document is not ready during document load.
        */
    ready: true,

    /**
      Provide client access to the game view.
     */
    gameView: function() {
      return this._singletonViews.gameView || null;
    }.property(),

      /**
       * Set by singleton AppController on startup
       * @property {SC.MenuPane}
       */
    guideMenuPane: null,

      /**
       * Set by singleton MainPage on startup
       * @property {DG.IconButton}
       */
    guideButton: null,

    _guideModel: null,
    guideModel: function() {
      if( !this._guideModel) {
        this._guideModel = DG.GuideModel.create();
      }
      return this._guideModel;
    }.property(),

    _guideController: null,
    guideController: function() {
      if( !this._guideController) {
        this._guideController = DG.GuideController.create( {
          guideModel: this.get('guideModel')
        });
      }
      return this._guideController;
    }.property(),

    /**
     *  The ID of the document managed by this controller.
     *  @property {String}
     */
    documentID: function() {
      return this.getPath('content.id');
    }.property('content.id'),

    /**
     *  The name of the document managed by this controller.
     *  @property {String}
     */
    documentName: function(iKey, iValue) {
      var content = this.get('content');
      if (iValue !== undefined) {
        content.set('name', iValue);
        DG.store.commitRecords();
      }
      return content.get('name');
    }.property('content.name'),

    /**
     * The permissions level of the document.
     * 0 = Private
     * 1 = Public
     * @property {Number}
     */
    documentPermissions: function() {
      return this.getPath('content._permissions') || 0;
    }.property('content._permissions'),

    /**
      The total number of document-dirtying changes.
      @property   {Number}
     */
    changeCount: 0,

    /**
      The number of document-dirtying changes that have been saved.
      If this is less than the total change count, then the document is dirty.
      @property   {Number}
     */
    savedChangeCount: 0,

    _changedObjects: null,
    _skipPatchNextTime: [],

    _lastCopiedDocument: null,
    externalDocumentId: null,

    isSaveEnabledBinding: SC.Binding.oneWay('DG.authorizationController.isSaveEnabled').bool(),

    canBeCopied: function() {
      return this.get('isSaveEnabled') &&
             this.get('documentName') !== SC.String.loc('DG.Document.defaultDocumentName') &&
             this.get('externalDocumentId');
    }.property('isSaveEnabled','documentName','savedChangeCount','externalDocumentId'),

    canBeReverted: function() {
      return this.get('canBeCopied');
    }.property('canBeCopied'),

    canBeShared: function() {
      return this.get('canBeCopied');
    }.property('canBeCopied'),

    /**
     * Set when save is in progress
     */
    saveInProgress: null,

    init: function() {
      sc_super();

      this._singletonViews = {};
      this.contexts = [];

      // If we were created with a 'content' property pointing to our document,
      // then use it; otherwise, create a new document.
      this.setDocument( this.get('content') || this.createDocument());

      this.clearChangedObjects();
    },

    destroy: function() {
      this.closeDocument();
      sc_super();
    },

    /**
      Creates a DG.Document with the specified name.
      If no name is passed in, uses the default document name.
      @param    {String}  iName -- [Optional] The name of the newly created document
      @returns  {DG.Document} --   The newly-created document
     */
    createDocument: function( iName) {
      var doc = DG.Document.createDocument({ name: iName || SC.String.loc('DG.Document.defaultDocumentName') });
      if (SC.none(iName)) {
        doc.set('_isPlaceholder', true);
      }
      return doc;
    },

    /**
      Sets the document to be managed by this controller.
      @param    {DG.Document} iDocument -- The document to be associated with this controller
     */
    setDocument: function( iDocument) {

      this.set('ready', false);
      this.set('content', iDocument);

      DG.DataContext.clearContextMap();
      this.componentControllersMap = {};

      // Create the individual DataContexts
      this.restoreDataContexts();

      // Create the individual component views
      this.restoreComponentControllersAndViews();

      this.clearChangedObjects();
      this.set('changeCount', 0);
      this.updateSavedChangeCount();
      this.set('externalDocumentId', null);
      this.set('ready', true);
    },

    gameHasUnsavedChangesBinding: SC.Binding.oneWay('DG._currGameController.hasUnsavedChanges').bool(),

    /**
      Whether or not the document contains unsaved changes such that the user
      should be prompted to confirm when closing the document, for instance.
      Note that we only respond true if the user has the ability to save,
      since there's little reason to prompt the user if they can't actually
      save. On review, however, it was pointed out that the ability to cancel
      might be useful event without the ability to save for users who didn't
      mean to logout, close the document, etc., but for now we're going to
      assume that won't happen often enough to warrant consideration.
      @property   {Boolean}
     */
    hasUnsavedChanges: function() {
      // Game controller state affects the document state
      return this.get('isSaveEnabled') &&
              ((this.get('changeCount') > this.get('savedChangeCount')) ||
              this.get('gameHasUnsavedChanges') ||
              this.get('_changedObjects').length > 0);
    }.property('isSaveEnabled','changeCount','savedChangeCount','gameHasUnsavedChanges','_changedObjects'),

    /**
      Synchronize the saved change count with the full change count.
      This method should be called when a save occurs, for instance.
     */
    updateSavedChangeCount: function() {
      // Game controller state affects the document state
      this.dataInteractives().forEach( function (gameController) {
        gameController.updateSavedChangeCount();
      });
      this.set('savedChangeCount', this.get('changeCount'));
    },

    objectChanged: function(obj) {
      var changes = this.get('_changedObjects');
      if (changes.indexOf(obj) === -1) {
        changes.push(obj);
        this.set('_changedObjects', changes);
      }
    },

    clearChangedObjects: function() {
      this.set('_changedObjects', []);
    },

    clearChangedObject: function(obj) {
      var changes = this.get('_changedObjects');
      var idx = changes.indexOf(obj);
      if (idx !== -1) {
        changes.splice(idx, 1);
        this.set('_changedObjects', changes);
      }
    },

    objectHasUnsavedChanges: function(obj) {
      var changes = this.get('_changedObjects');
      return changes.indexOf(obj) !== -1;
    },

    /**
      Creates an appropriate DG.DataContext for the specified DG.DataContextRecord object.
      If no model is specified, creates the DG.DataContextRecord as well.
      @param    {DG.DataContextRecord}  iModel -- [Optional] The model for which to create the DG.DataContext.
      @param    {Object}                iProperties -- Constructor arguments for the new DG.DataContext.
      @returns  {DG.DataContext}                  The newly created DG.DataContext.
     */
    createDataContextForModel: function( iModel, iProperties) {
      // Create the model if one isn't passed in
      if( SC.none( iModel))
        iModel = DG.DataContextRecord.createContext({ document: this.get('documentID') });
      if( !iProperties) iProperties = {};
      iProperties.type = iModel.get('type');
      iProperties.model = iModel;
      var context = DG.DataContext.factory( iProperties);
      this.get('contexts').push(context);
      return context;
    },

    /**
      Creates an appropriate DG.DataContext for each DG.DataContextRecord in the document.
      Can be used after restoring a document, for instance.
     */
    restoreDataContexts: function () {
      var contextRecords = this.get('contextRecords') || [];
      DG.ObjectMap.forEach(contextRecords, function (key, iContextModel) {
        var newContext = this.createDataContextForModel(iContextModel);
        if (newContext) {
          newContext.restoreFromStorage(iContextModel.get('contextStorage'));
        }
        //this.contexts.push(newContext);
      }.bind(this));
    },

    createNewDataContext: function(iProps) {
      var contextRecord = DG.DataContextRecord.createContext(iProps),
          context = this.createDataContextForModel(contextRecord);
      if (contextRecord.contextStorage) {
        context.restoreFromStorage(contextRecord.contextStorage);
      }
      //this.contexts.push(context);
      return context;
    },

    /**
      Creates the specified component and its associated view.
      Clients should specify either iComponent or iComponentType.
      @param    {DG.ComponentModel} iComponent [Optional] -- The restored component.
                                        Should be specified when restoring from document.
      @param    {String}            iComponentType [Optional] -- The type of component to create.
     */
    createComponentAndView: function( iComponent, iComponentType) {
      var docView = DG.mainPage.get('docView'),
          type = (iComponent && iComponent.get('type')) || iComponentType,
          didCreateComponent = true,
          tView = null;

      switch( type) {
      case 'DG.FlashView':  // For backward compatibility
        if( iComponent)
          iComponent.set('type', 'DG.GameView');
        // fallthrough intentional
        /* jshint -W086 */  // Expected a 'break' statement before 'case'. (W086)
      case 'DG.GameView':
        tView = this.addGame( docView, iComponent);
        break;
      case 'DG.TableView':
        // If there is no component, we are creating new components.
        // We currently create case tables for each context, rather than creating
        // them on a context-by-context basis. This may change, for now this means
          // if we are asked to create *a* case table we will create all case
          // tables.
        if (iComponent) {
          tView = this.addCaseTable(docView, iComponent);
        } else {
          this.openCaseTablesForEachContext( );
        }
        break;
      case 'DG.GraphView':
        tView = this.addGraph( docView, iComponent);
        break;
      case 'DG.SliderView':
        tView = this.addSlider( docView, iComponent);
        break;
      case 'DG.Calculator':
        tView = this.addCalculator( docView, iComponent);
        break;
      case 'DG.TextView':
        tView = this.addText( docView, iComponent);
        break;
      case 'DG.MapView':
        tView = this.addMap( docView, iComponent);
        break;
      case 'SC.WebView':
        tView = this.addWebView( docView, iComponent);
        break;
      case 'DG.GuideView':
        tView = this.addGuideView( docView, iComponent);
        break;
      default:
        didCreateComponent = false;
        break;
      }

      if( iComponent)
        iComponent.didLoadRecord();

      if( didCreateComponent)
        DG.dirtyCurrentDocument();

      return tView;
    },

    /**
      Creates an appropriate DG.ComponentView for each DG.Component in the document.
      Can be used after restoring a document, for instance.
     */
    restoreComponentControllersAndViews: function() {
      var components = this.get('components');
      if( components) {
        DG.ObjectMap.forEach(components, function(key, iComponent) {
                              this.createComponentAndView( iComponent);
                            }.bind( this));
      }
    },

    /**
      [DEPRECATED] Returns the collection with the specified name associated with the game of the specified name.
      Clients should use the DG.DataContext API instead.
      @param  {String}    iGameName -- The name of the game for which a collection is desired
      @param  {String}    iCollectionName -- The name of the collection to be returned
      @returns  {DG.CollectionClient}   The collection that matches the specified names
     */
    gameCollectionWithName: function( iGameName, iCollectionName) {
      var gameSpec = DG.gameSelectionController.findGameByName( iGameName),
          gameContext = gameSpec && DG.GameContext.getContextForGame( gameSpec),
          collection = gameContext && gameContext.getCollectionByName( iCollectionName);
      return collection;
    },

    /**
      [DEPRECATED] Returns the default DG.CollectionClient and default X and Y attributes to plot for
      development purposes. Should eventually be removed once the game is able to specify appropriate
      defaults, and clients get them from the DG.GameContext directly.
      @returns  {Object}  An Object whose properties specify usable defaults, e.g.
                {Object.collectionClient} {DG.CollectionClient} Default collection to use
                {Object.parentCollectionClient} {DG.CollectionClient} Default parent collection
                {Object.plotXAttr}  {DG.Attribute}  The attribute to plot on the X axis by default
                {Object.plotXAttrIsNumeric}  {Boolean}  Whether the default X axis attribute is numeric
                {Object.plotYAttr}  {DG.Attribute}  The attribute to plot on the Y axis by default
                {Object.plotYAttrIsNumeric}  {Boolean}  Whether the default Y axis attribute is numeric
     */
    collectionDefaults: function() {
      var gameContext,
          defaults;
      if (this.get('contexts').length === 1) {
        gameContext = this.get('contexts')[0];
        defaults = gameContext && gameContext.collectionDefaults();
      } else {
        defaults = DG.DataContext.collectionDefaults();
      }
      return defaults;
    },

    /**
      Configures/initializes the specified component, using the specified params as options.
      If iComponent is not specified, it will be created. Whether the component is created
      or passed in, it will then be initialized, using the specified parameters. This allows
      initialization to be handled in common, whether components are newly created by the
      user or restored from document.
      @param  {DG.Component}  iComponent -- [Optional] The component to be initialized/configured.
                                            If not provided, it will be created.
      @param {Object}         iParams --  Initialization/configuration properties
     */
    configureComponent: function( iComponent, iParams) {
      var isRestoring = !SC.none( iComponent),
          documentID = this.get('documentID'),
          tComponent = iComponent,
          tController = iParams.controller;

      // If we're not restoring, then we must create it.
      if( !isRestoring) {
        var tComponentProperties = { type: iParams.componentClass.type };
        // If we create it, hook it up to the document.
        if( !SC.none(this.content))
          tComponentProperties.document = this.content;
        tComponent = DG.Component.createComponent( tComponentProperties);
      }

      // If client specified a model, associate it with the component in our map
      if( iParams.contentProperties && iParams.contentProperties.model)
        tComponent.set('content', iParams.contentProperties.model);

      // Hook up the controller to its model (the component)
      tController.set('model', tComponent);

      // Add the component controller to our registry of component controllers
      this.componentControllersMap[ tComponent.get('id')] = tController;

      // If we're restoring, restore the archived contents
      if( isRestoring) {
        // restore from archive
        tController.didRestoreComponent( documentID);
      }

      return tComponent;
    },

    createComponentView: function(iComponent, iParams) {
      var tLayout = iParams && iParams.defaultLayout,
          isRestoring = !SC.none( iComponent),
          tComponent, tComponentView;

      DG.globalEditorLock.commitCurrentEdit();

      //
      // Configure/create the component and hook it up to the controller
      //
      tComponent = this.configureComponent( iComponent, iParams);

      //
      // Configure/create the view and connect it to the controller
      //
      if( tComponent && tComponent.get('layout'))
         tLayout = tComponent.get('layout');

      if( isRestoring) {
        tComponentView = DG.ComponentView.restoreComponent( iParams.parentView, tLayout,
                                                       iParams.componentClass.constructor,
                                                       iParams.contentProperties,
                                                       iParams.title, iParams.isResizable,
                                                       iParams.useLayout);
      } else {
        DG.sounds.playCreate();
        tComponentView = DG.ComponentView.addComponent( iParams.parentView, tLayout,
                                                      iParams.componentClass.constructor,
                                                      iParams.contentProperties,
                                                      iParams.title, iParams.isResizable,
                                                      iParams.useLayout,
                                                      iParams.isVisible);
        var defaultFirstResponder = tComponentView && tComponentView.getPath('contentView.defaultFirstResponder');
        if( defaultFirstResponder) {
          if( defaultFirstResponder.beginEditing) {
            defaultFirstResponder.beginEditing();
          }
          else if( defaultFirstResponder.becomeFirstResponder) {
            defaultFirstResponder.becomeFirstResponder();
          }
        }
      }

      // Tell the controller about the new view, whose layout we will need when archiving.
      if( iParams.controller) {
        iParams.controller.set('view', tComponentView);
        tComponentView.set('controller', iParams.controller);
      }

      if( tComponentView)
        DG.dirtyCurrentDocument();

      return tComponentView;
    },

    addGame: function (iParentView, iComponent) {
      var tGameParams = {
          width: 640, height: 480
        },
        tGameUrl = (iComponent && iComponent.getPath(
          'componentStorage.currentGameUrl')),
        tGameName = (iComponent && iComponent.getPath(
            'componentStorage.currentGameName')) || 'Unknown Game',
        tController = DG.GameController.create(),
        tView = this.createComponentView(iComponent, {
            parentView: iParentView,
            controller: tController,
            componentClass: {
              type: 'DG.GameView', constructor: DG.GameView
            },
            contentProperties: {
              controller: tController, value: tGameUrl, name: tGameName
            },
            defaultLayout: {
              width: tGameParams.width,
              height: tGameParams.height
            },
            title: tGameName,
            isResizable: true,
            useLayout: false
          }  // may change this to false in the future
        );

      // Override default component view behavior.
      // Do nothing until we figure out how to prevent reloading of Flash object.
      tView.bringToFront = function () { };

      return tView;
    },

    addCaseTable: function( iParentView, iComponent) {
      function resolveContextLink(iComponent) {
        var id = DG.ArchiveUtils.getLinkID(iComponent.componentStorage, 'context');
        if (id) {
          return iComponent.document.contexts[id];
        }
      }
      var context = resolveContextLink(iComponent),
        contextName = (context && context.contextStorage && context.contextStorage.gameName)
          || 'DG.DocumentController.caseTableTitle'.loc(),  // "Case Table"
        tView = this.createComponentView(iComponent, {
          parentView: iParentView,
          controller: DG.CaseTableController.create(),
          componentClass: { type: 'DG.TableView', constructor: DG.HierTableView},
          contentProperties: {},
          defaultLayout: { width: 500, height: 200 },
          title: contextName,
          isResizable: true}
      );
      return tView;
    },

    /*
       An alternate implementation of addCaseTable that adds the ability to pass
       parameters. Needed for multiple data contexts.
       */
    addCaseTableP: function( iParentView, iComponent, iProperties) {

      var props = SC.Object.create({
        parentView: iParentView,
        controller: DG.CaseTableController.create(iProperties),
        componentClass: { type: 'DG.TableView', constructor: DG.HierTableView},
        contentProperties: {},
        defaultLayout: { width: 500, height: 200 },
        title: iProperties.dataContext.gameName ||
            'DG.DocumentController.caseTableTitle'.loc(),  // "Case Table"
        isResizable: true}), tView;
      DG.ObjectMap.copy(props, iProperties);
      tView = this.createComponentView(iComponent, props);
      return tView;
    },

    openCaseTablesForEachContext: function () {
      var caseTables = this.findComponentsByType(DG.CaseTableController),
          docController = this, newViews;
      function haveCaseTableForContext (context) {
        var ix;
        for (ix = 0; ix < caseTables.length; ix += 1) {
          if (caseTables[ix].dataContext === context) { return true; }
        }
        return false;
      }
      DG.UndoHistory.execute(DG.Command.create({
        name: 'caseTable.display',
        undoString: 'DG.Undo.caseTable.open',
        redoString: 'DG.Redo.caseTable.open',
        execute: function() {
          newViews = [];
          DG.DataContext.forEachContextInMap(null, function (id, context) {
            if (!haveCaseTableForContext(context)) {
              newViews.push(this.addCaseTableP(DG.mainPage.get('docView'),
                null, {dataContext: context}));
            }
          }.bind(docController));
          if (newViews.length === 0) {
            this.causedChange = false;
          }
        },
        undo: function() {
          var containerView;
          newViews.forEach(function(view) {
            containerView = view.parentView;
            containerView.removeComponentView(view);
          });
        },
        redo: function() {
          this.execute();
        }
      }));
    },

    addGraph: function( iParentView, iComponent) {
      var tView, docController = this;

      //DG.UndoHistory.execute(DG.Command.create({
      //  name: "graphComponent.create",
      //  undoString: 'DG.Undo.graphComponent.create',
      //  redoString: 'DG.Redo.graphComponent.create',
      //  execute: function() {
          SC.Benchmark.start('addGraph');
          var tGraphModel = DG.GraphModel.create(),
            tGraphController = DG.GraphController.create(),
            tContextIds = DG.DataContext.contextIDs(null);

          if (SC.none(iComponent) && DG.ObjectMap.length(tContextIds) === 1) {
            tGraphController.set('dataContext',
              DG.DataContext.retrieveContextFromMap(null, tContextIds[0]));
          }
          tView = docController.createComponentView(iComponent, {
                                  parentView: iParentView,
                                  controller: tGraphController,
                                  componentClass: { type: 'DG.GraphView', constructor: DG.GraphView},
                                  contentProperties: { model: tGraphModel },
                                  defaultLayout: { width: 300, height: 300 },
                                  title: 'DG.DocumentController.graphTitle'.loc(),  // "Graph"
                                  isResizable: true}
                                );

          SC.Benchmark.end('addGraph');
          SC.Benchmark.log('addGraph');
        //},
        //undo: function() {
        //  tView.parentView.removeComponentView(tView);
        //}
      //}));
      return tView;
    },

    addText: function( iParentView, iComponent) {
      var tView, docController = this;

      //DG.UndoHistory.execute(DG.Command.create({
      //  name: "textComponent.create",
      //  undoString: 'DG.Undo.textComponent.create',
      //  redoString: 'DG.Redo.textComponent.create',
      //  execute: function() {
          tView = docController.createComponentView(iComponent, {
                                parentView: iParentView,
                                controller: DG.TextComponentController.create(),
                                componentClass: { type: 'DG.TextView', constructor: DG.TextView},
                                contentProperties: { hint: "Type some notes here…" },
                                defaultLayout: { width: 300, height: 100 },
                                title: 'DG.DocumentController.textTitle'.loc(), // "Text"
                                isResizable: true}
                              );
      //  },
      //  undo: function() {
      //    tView.parentView.removeComponentView(tView);
      //  }
      //}));
      return tView;
    },

    addMap: function( iParentView, iComponent) {
      var tView, docController = this;

      DG.UndoHistory.execute(DG.Command.create({
        name: "map.create",
        undoString: 'DG.Undo.map.create',
        redoString: 'DG.Redo.map.create',
        execute: function() {
          var tMapModel = DG.MapModel.create(),
              tMapController = DG.MapController.create(),
              tContextIds = DG.DataContext.contextIDs(null),
              tContext;

          if (DG.ObjectMap.length(tContextIds) === 1) {
            tContext = DG.DataContext.retrieveContextFromMap(null, tContextIds[0]);
            // Don't pass the data context in the constructor because it's a function property
            tMapModel.set('dataContext',  tContext);
            tMapController.set('dataContext', tContext);
          }

          // map as component
          tView = docController.createComponentView(iComponent, {
                                    parentView: iParentView,
                                    controller: tMapController,
                                    componentClass: { type: 'DG.MapView', constructor: DG.MapView},
                                    contentProperties: { model: tMapModel },
                                    defaultLayout: { width: 700, height: 450 },
                                    title: 'DG.DocumentController.mapTitle'.loc(), // "Map"
                                    isResizable: true}
                                  );
        },
        undo: function() {
          tView.parentView.removeComponentView(tView);
        }
      }));
      return tView;
    },

    addSlider: function( iParentView, iComponent) {
      var tView, sliderController, modelProps = {}, docController = this;

      DG.UndoHistory.execute(DG.Command.create({
        name: "sliderComponent.create",
        undoString: 'DG.Undo.sliderComponent.create',
        redoString: 'DG.Redo.sliderComponent.create',
        execute: function() {
          if( !iComponent || !iComponent.get('componentStorage'))
            modelProps.content = docController.createGlobalValue();
          var tSliderModel = DG.SliderModel.create( modelProps);
          sliderController = DG.SliderController.create();
          tView = docController.createComponentView(iComponent, {
                                parentView: iParentView,
                                controller: sliderController,
                                componentClass: { type: 'DG.SliderView', constructor: DG.SliderView},
                                contentProperties: { model: tSliderModel },
                                defaultLayout: { width: 300, height: 60 },
                                title: 'DG.DocumentController.sliderTitle'.loc(), // "Slider"
                                isResizable: true}
                              );
        },
        undo: function() {
          // Store the component so that when we redo, we'll get the same global variable (v1, v2, etc.)
          sliderController.willSaveComponent();
          tView.parentView.removeComponentView(tView);
          DG.globalsController.destroyGlobalValue(modelProps.content);
        }
      }));
      return tView;
    },

    addCalculator: function( iParentView, iComponent) {
      var tView = this.createComponentView(iComponent, {
                                parentView: iParentView,
                                controller: DG.ComponentController.create(),
                                componentClass: { type: 'DG.Calculator', constructor: DG.Calculator},
                                contentProperties: { },
                                defaultLayout: { },
                                title: 'DG.DocumentController.calculatorTitle'.loc(), // "Calculator"
                                isResizable: false}
                              );
      this._singletonViews.calcView = tView;
      return tView;
    },

    /**
     * Puts a modal dialog with a place for a URL. If user OK's, the URL is used for an added web view.
     */
    viewWebPage: function() {

      var this_ = this,
          tDialog = null;

      function createWebPage() {
        // User has pressed OK. tURL must have a value or 'OK' disabled.
        var tURL = tDialog.get('value');
        tDialog.close();
        // If url does not contain http:// or https:// at the beginning, append http://
        if (!/^https?:\/\//i.test(tURL)) {
          tURL = 'http://' + tURL;
        }
        this_.addWebView(  DG.mainPage.get('docView'), null,
                tURL, 'Web Page',
                { width: 600, height: 400 });
      }

      tDialog = DG.CreateSingleTextDialog( {
                      prompt: 'DG.DocumentController.enterURLPrompt',
                      textValue: '',
                      textHint: 'URL',
                      okTarget: null,
                      okAction: createWebPage,
                      okTooltip: 'DG.DocumentController.enterViewWebPageOKTip'
                    });
    },

    addWebView: function( iParentView, iComponent, iURL, iTitle, iLayout) {
      iURL = iURL || '';
      iTitle = iTitle || '';
      iLayout = iLayout || { width: 600, height: 400 };
      return this.createComponentView(iComponent, {
                              parentView: iParentView,
                              controller: DG.WebViewController.create(),
                              componentClass: { type: 'SC.WebView', constructor: SC.WebView},
                              contentProperties: { value: iURL, backgroundColor: 'white' },
                              defaultLayout: iLayout,
                              title: iTitle,
                              isResizable: true,
                              useLayout: !SC.none(iLayout.centerX) || !SC.none(iLayout.left) }
                            );
    },

    addGuideView: function( iParentView, iComponent) {
      if( this._singletonViews.guideView)
        return; // only one allowed

      var tModel = this.get('guideModel'),
          tController = this.get('guideController' ),
          tView = this.createComponentView(iComponent, {
                              parentView: iParentView,
                              controller: tController,
                              componentClass: { type: 'DG.GuideView', constructor: DG.GuideView},
                              contentProperties: { backgroundColor: 'white', guideModel: tModel,
                                                    controller: tController
                                ,
                                                    closeAction: { action: this.closeGuideView, target: this }
                              },
                              defaultLayout: { width: 400, height: 200 },
                              isResizable: true,
                              useLayout: true,
                              isVisible: false }
                            );
      this._singletonViews.guideView = tView;
      return tView;
    },

    /**
     * This gets called when the user 'closes' the guide view. Instead of removing the
     * component and its view, we just hide it for future use.
     */
    closeGuideView: function() {
      var tGuideComponentView = this._singletonViews.guideView;
      if( tGuideComponentView) {
        DG.logUser("closeComponent: Guide - %@", tGuideComponentView.get('title'));
        tGuideComponentView.set('isVisible', false);
      }
    },

    /**
     * Puts a modal dialog with a place for a URL. If user OK's, the URL is used for an added web view.
     */
    configureGuide: function() {

      var tDialog = null,
          tGuideModel = this.get('guideModel');

        var storeGuideModel = function () {
          this.addGuideView( DG.mainPage.docView);  // Make sure we have one hooked up to model
          tGuideModel.beginPropertyChanges();
            tGuideModel.set('title', tDialog.get('title'));
            tGuideModel.set('items', tDialog.get('items'));
          tGuideModel.endPropertyChanges();
          tDialog.close();
        }.bind(this);

      tDialog = DG.CreateGuideConfigurationView( {
                      okTarget: null,
                      okAction: storeGuideModel,
                      model: tGuideModel
                    });
    },

    /**
     * If we have both a button and a menu pane, we can pass them to the guideController.
     */
    guideButtonOrMenuDidChange: function() {
      var tButton = this.get('guideButton' ),
          tPane = this.get('guideMenuPane');
      if( tButton && tPane) {
        var tController = this.get('guideController');
        tController.set('guideButton', tButton);
        tController.set('guideMenuPane', tPane);
      }
    }.observes('guideButton', 'guideMenuPane'),

    toggleComponent: function( iDocView, iComponentName) {
      var componentView = this._singletonViews[ iComponentName],
          componentArchive;
      // If it already exists, then delete it.
      if( componentView) {
        DG.UndoHistory.execute(DG.Command.create({
          name: 'component.toggle.delete',
          undoString: 'DG.Undo.toggleComponent.delete.' + iComponentName,
          redoString: 'DG.Redo.toggleComponent.delete.' + iComponentName,
          execute: function() {
            componentArchive = this._archiveComponent(iComponentName);
            this._deleteComponent(iComponentName);
          }.bind(this),
          undo: function() {
            this._addComponent(iComponentName, iDocView, componentArchive);
          }.bind(this),
          redo: function() {
            this._deleteComponent(iComponentName);
          }.bind(this)
        }));
      }
      // If it doesn't exist, then create it.
      else {
        DG.UndoHistory.execute(DG.Command.create({
          name: 'component.toggle.add',
          undoString: 'DG.Undo.toggleComponent.add.' + iComponentName,
          redoString: 'DG.Redo.toggleComponent.add.' + iComponentName,
          execute: function() {
            this._addComponent(iComponentName, iDocView);
          }.bind(this),
          undo: function() {
            componentArchive = this._archiveComponent(iComponentName);
            this._deleteComponent(iComponentName);
          }.bind(this),
          redo: function() {
            this._addComponent(iComponentName, iDocView, componentArchive);
          }.bind(this)
        }));
      }
    },

    /**
     * Helper for toggleComponent. Creates a new component and adds it to the view/document.
     */
    _addComponent: function(iComponentName, iDocView, componentArchive) {
      var component = componentArchive ? DG.Component.createComponent(componentArchive) : null;
      switch( iComponentName) {
        case 'calcView':
          this.addCalculator( iDocView, component);
          break;
      }
    },

    /**
     * Helper for toggleComponent. Saves a component's state in preparation for being deleted,
     * so we can restore it later.
     */
    _archiveComponent: function(iComponentName) {
      var component = this._singletonViews[ iComponentName].getPath('controller.model'),
          componentArchive = component.toArchive();
      componentArchive.document = component.get('document');
      return componentArchive;
    },

    /**
     * Helper for toggleComponent. Finds the right component and removes it from the view/document.
     */
    _deleteComponent: function(iComponentName) {
      var componentView = this._singletonViews[ iComponentName];
      this.removeComponentAssociatedWithView( componentView);
      componentView.destroy();
    },

    closeDocument: function() {
      DG.ObjectMap.forEach( this.componentControllersMap,
                            function( iComponentID, iController) {
                              if( iController && iController.willDestroy)
                                iController.willDestroy();
                            });

      DG.globalsController.stopAnimation();
      DG.gameSelectionController.reset();
      DG.DataContext.clearContextMap();

      DG.Document.destroyDocument(DG.activeDocument);

      this.contexts = [];
      this.closeAllComponents();
    },

    closeAllComponents: function() {
      this._singletonViews = {};

      this.componentControllersMap = {};

      // Reset the guide
      this.get('guideModel').reset();
    },
    findComponentsByType: function (iType) {
      var tResults = [];
      DG.ObjectMap.forEach(this.componentControllersMap, function (key, componentController) {
        if (componentController.constructor === iType) {
          tResults.push(componentController);
        }
      });
      return tResults;
    },
    removeComponentAssociatedWithView: function( iComponentView, iSkipDirtyingDocument) {
      var tController = null,
          tComponentID = DG.ObjectMap.findKey( this.componentControllersMap,
                                                function( iComponentID, iController) {
                                                  if( iController.view === iComponentView) {
                                                    tController = iController;
                                                    return true;
                                                  }
                                                  return false;
                                                });

      // If this is a singleton view, clear its entry
      var tViewID = DG.ObjectMap.findValue( this._singletonViews, iComponentView);
      if( tViewID && this._singletonViews[ tViewID])
        this._singletonViews[ tViewID] = null;

      if( tController) {
        var model = tController.get('model');
        if( model)
          DG.Component.destroyComponent( model);
        delete this.componentControllersMap[ tComponentID];
        if( tController.get('shouldDestroyOnComponentDestroy')) {
          tController.destroy();
        }
        else {
          tController.set('model', null);
          tController.set('view', null);
        }

        // Closing a component should generally dirty the document, unless
        // we're explicitly chosing not to
        if (!iSkipDirtyingDocument) {
          DG.dirtyCurrentDocument();
        }
      }
      // the view will be destroyed elsewhere
    },

    addFormulaObject: function( iParentView, iComponent, iTitle, iDescription, iOutputSymbol, iNameSpaceSymbols,
                                iDescriptions, iAllowUserVariables) {
      var tView = this.createComponentView(iComponent, {
                                parentView: iParentView,
                                controller: DG.ComponentController.create({}),
                                componentClass: { type: 'DG.FormulaObject', constructor: DG.FormulaObject},
                                contentProperties: {  description: iDescription,
                                                      outputSymbol: iOutputSymbol,
                                                      nameSpaceSymbols: iNameSpaceSymbols,
                                                      variableDescriptions: iDescriptions,
                                                      allow_user_variables: iAllowUserVariables},
                                defaultLayout: {},
                                title: iTitle,
                                isResizable: true
                                }
                              );

      return tView;
    },

    createGlobalValue: function( iProperties) {
      iProperties = iProperties || {};
      iProperties.document = this.get('content');
      return DG.globalsController.createGlobalValue( iProperties);
    },

    /**
      Returns an object which contains the contents of the document suitable for conversion
      to JSON and sending to the server.

      Signature of `callback`:
      @param  {Object} docArchive an object representing the document suitable for JSON-conversion
    */
    exportDocument: function(callback, fullData) {
      var archiver = DG.DocumentArchiver.create({});
      archiver.saveDocument( this.get('content'), callback, fullData);
    },

    exportDataContexts: function(callback, exportAll) {
      var archiver = DG.DocumentArchiver.create({});
      return archiver.saveDataContexts( this.get('content'), callback, exportAll);
    },

    signalSaveInProgress: function() {
      var saveInProgress = $.Deferred();
      saveInProgress.done(function() { this.set('saveInProgress', null); }.bind(this));
      this.set('saveInProgress', saveInProgress);
      return saveInProgress;
    },

    /**
      Archive the document into durable form, and save it.

      @param {String} iDocumentId   The unique Id of the document as known to the server.
    */
    saveDocument: function( iDocumentId, iDocumentPermissions) {
      var promises = [],
        existingSaveInProgress = this.get('saveInProgress'),
        saveInProgress,
        exportDeferred;
      if (!SC.none(existingSaveInProgress)) {
        return;
      }
      saveInProgress = this.signalSaveInProgress();
      this.updateSavedChangeCount();
      exportDeferred = this.exportDataContexts(function(context, docArchive) {
        // Ensure that _permissions matches the main document
        var needsSave = false;
        if( !SC.none( iDocumentPermissions)) {
          if (docArchive._permissions !== iDocumentPermissions) {
            needsSave = true;
          }
          docArchive._permissions = iDocumentPermissions;
        }

        // FIXME If we toggle splitting on and off, we'll need to change this test
        if( DG.assert( !SC.none(docArchive)) && (needsSave || this.objectHasUnsavedChanges(context) || SC.none(context.get('externalDocumentId'))) ) {
          this.clearChangedObject(context);
          var p,
              cleaned_docArchive = JSON.parse(JSON.stringify(docArchive)), // Strips all keys with undefined values
              should_skip = this._skipPatchNextTime.indexOf(context) !== -1;
          // Only use differential saving if 1) enabled and 2) we've already saved it at least once (ie have a document id)

          if (DG.USE_DIFFERENTIAL_SAVING && !should_skip && !SC.none(context.get('externalDocumentId'))) {
            var differences = jiff.diff(context.savedShadowCopy(), cleaned_docArchive, function(obj) { return obj.guid || JSON.stringify(obj); });
            if (differences.length === 0) { return; }
            p = DG.authorizationController.saveExternalDataContext(context, iDocumentId, differences, this, false, true);
          } else {
            p = DG.authorizationController.saveExternalDataContext(context, iDocumentId, docArchive, this);
            if (SC.none(context.get('externalDocumentId'))) {
              // This will change the main document by replacing the data context with an id, so we need to make sure the parent saves, too.
              DG.dirtyCurrentDocument();
            }
          }
          p.then(function(success) {
            if (success) {
              if (DG.USE_DIFFERENTIAL_SAVING || should_skip) {
                context.updateSavedShadowCopy(cleaned_docArchive);
              }
              if (should_skip) {
                this._skipPatchNextTime.splice(this._skipPatchNextTime.indexOf(context), 1);
              }
            } else {
              DG.dirtyCurrentDocument(context);
            }
          }.bind(this));
          promises.push(p);
        }
      }.bind(this), DG.FORCE_SPLIT_DOCUMENT); // FIXME This forces data contexts to always be in a separate doc. Should this depend on other factors?
      exportDeferred.done(function() {
        Promise.all(promises).then(function() {
          // FIXME What should we do if a data context fails to save?
          this.exportDocument(function(docArchive) {
            var needsSave = this.objectHasUnsavedChanges(this.get('content'));
            if( !SC.none( iDocumentPermissions) && docArchive._permissions !== iDocumentPermissions) {
              docArchive._permissions = iDocumentPermissions;
              this.setPath('content._permissions', iDocumentPermissions);
              needsSave = true;
            }

            if( DG.assert( !SC.none(docArchive))) {
              if (needsSave) {
                DG.authorizationController.saveDocument(iDocumentId, docArchive, this).then(function(success) {
                  if (!success) {
                    DG.dirtyCurrentDocument();
                  }
                  saveInProgress.resolve();
                });
              } else {
                this.invokeLater(function() { saveInProgress.resolve(); });
              }
            }

            this.clearChangedObject(this.get('content'));
          }.bind(this));
        }.bind(this));
      }.bind(this));
    },

    receivedSaveDocumentSuccess: function(body, isCopy) {
      return new Promise(function(resolve, reject) {
        var newDocId = body.id;
        if (isCopy) {
          var url = DG.appController.copyLink(newDocId);
          if (DG.authorizationController.getPath('currLogin.user') === 'guest') {
            url = $.param.querystring(url, {runAsGuest: 'true'});
          }
          var win = window.open(url, '_blank');
          if (win) {
            win.focus();
          } else {
            DG.appController.showCopyLink(url);
          }
        } else {
          this.set('externalDocumentId', ''+newDocId);
          DG.appController.triggerSaveNotification();
        }
        resolve(true);
      }.bind(this));
    },

    receivedSaveDocumentFailure: function(errorCode, isCopy) {
      return new Promise(function(resolve, reject) {
        var messageBase = 'DG.AppController.' + (isCopy ? 'copyDocument' : 'saveDocument') + '.';
        DG.appController.notifyStorageFailure(messageBase, errorCode, resolve);
      }.bind(this));
    },

    receivedSaveExternalDataContextSuccess: function(body, isCopy, contextModel) {
      return new Promise(function(resolve, reject) {
        var newDocId = body.id;
        SC.run(function() {
          if (isCopy) {
            contextModel.set('oldExternalDocumentId', contextModel.get('externalDocumentId'));
          }
          contextModel.set('externalDocumentId', ''+newDocId);

          this.invokeLater(function() {
            resolve(true);
          });
        }.bind(this));
      }.bind(this));
    },

    receivedSaveExternalDataContextFailure: function(errorCode, isCopy, contextModel) {
      return new Promise(function(resolve, reject) {
        if (errorCode === 'error.invalidPatch') {
          this._skipPatchNextTime.push(contextModel);
        }
        DG.appController.notifyStorageFailure('DG.AppController.saveDocument.', errorCode);
      }.bind(this));
    },

    /**
      Archive the document into durable form, and save it.

      @param {String} iDocumentId   The unique Id of the document as known to the server.
    */
    copyDocument: function( iDocumentId, iDocumentPermissions) {
      var deferreds = [],
        existingSaveInProgress = this.get('saveInProgress'),
        saveInProgress,
        exportDeferred;
      if (!SC.none(existingSaveInProgress)) {
        existingSaveInProgress.done(function() { this.copyDocument(iDocumentId, iDocumentPermissions); }.bind(this));
        return;
      }
      saveInProgress = this.signalSaveInProgress();

      var oldDifferentialSaving = DG.USE_DIFFERENTIAL_SAVING;
      DG.USE_DIFFERENTIAL_SAVING = false;
      saveInProgress.done(function() { DG.USE_DIFFERENTIAL_SAVING = oldDifferentialSaving; });

      exportDeferred = this.exportDataContexts(function(context, docArchive) {
        if( DG.assert( !SC.none(docArchive))) {
          // Ensure that _permissions matches the main document
          if( !SC.none( iDocumentPermissions)) {
            docArchive._permissions = iDocumentPermissions;
          }
          deferreds.push(DG.authorizationController.saveExternalDataContext(context, iDocumentId, docArchive, this, true));
        }
      }.bind(this), DG.FORCE_SPLIT_DOCUMENT); // FIXME This forces data contexts to always be in a separate doc. Should this depend on other factors?
      exportDeferred.done(function() {
        $.when.apply($, deferreds).done(function() {
          // FIXME What do we do when a data context fails to save?
          this.exportDocument( function( docArchive) {
            docArchive.name = iDocumentId;
            if (!SC.none(iDocumentPermissions))
              docArchive._permissions = iDocumentPermissions;

            if (DG.assert(!SC.none(docArchive))) {
              DG.authorizationController.saveDocument(iDocumentId, docArchive, this, true).then(function() {
                // Set the externalDocumentIds back
                DG.DataContext.forEachContextInMap( this.getPath('content.id'),
                                              function( iContextID, iContext) {
                                                var model = iContext.get('model');
                                                if ( !SC.none(model.get('externalDocumentId'))) {
                                                  model.set('externalDocumentId', model.get('oldExternalDocumentId'));
                                                  model.set('oldExternalDocumentId', null);
                                                }
                                              });
                saveInProgress.resolve();
              }.bind(this));
            }
          }.bind(this));
        }.bind(this));
      }.bind(this));
    },

    deleteDocument: function(iDocumentId) {
      DG.authorizationController.deleteDocument(iDocumentId, this);
    },

    receivedDeleteDocumentSuccess: function(body) {
      // We don't need to do anything
    },

    receivedDeleteDocumentFailure: function(errorCode) {
      DG.appController.notifyStorageFailure('DG.AppController.deleteDocument.', errorCode);
    },
    /**
     Saves the current state of the current game into the 'savedGameState'
     property of the current game's context.

     @param {function} done A callback.
     */
    saveCurrentGameState: function(done) {
      var gameControllers = this.get('dataInteractives'),
          promises = [];
      if (gameControllers) {
        gameControllers.forEach(function (gameController) {
          var gameContext = gameController.get('context');

          // create an array of promises, one for each data interactive.
          // issue the request in the promise.
          promises.push(new Promise(function (resolve, reject) {
            try {
              if( gameContext && gameController.saveGameState) {
                gameController.saveGameState(function(result) {
                  if (result && result.success) {
                    gameContext.set('savedGameState', result.state);
                  } else {
                    DG.logWarn("No channel to Data Interactive: " + gameContext.get('gameName'));
                    result = {success:false};
                  }
                  resolve(result);
                });
              } else {
                // This would occur if there is no means of communicating with
                // a data interactive. We immediately resolve.
                resolve({success:true});
              }
            } catch (ex) {
              DG.logWarn("Exception saving game context(" + gameContext.get('gameName') + "): " + ex);
              resolve({success:false});
            }
          }));
        });
        // when all promises in the array of promises complete, then call the callback
        Promise.all(promises).then(function (value) {
            DG.logInfo('saveCurrentGameState complete.');
            done();
          },
          function (reason) {
            DG.logWarn('saveCurrentGameState failed: ' + reason);
            done();
          }
        );
      }

      // For consistency with gamePhone case, make sure that done callback is invoked in a later
      // turn of the event loop. Also, don't bind it to 'this' (but don't override its this-binding)
      //this.invokeLater(function() { done(); } );
    }
  }
);

DG.currDocumentController = function() {
  if( !DG._currDocumentController) {
    DG._currDocumentController = DG.DocumentController.create();
    DG._currDocumentController.set('guideMenuPane', DG.appController.get('guideMenuPane'));
  }
  return DG._currDocumentController;
}.property();

DG.gameCollectionWithName = function( iGameName, iCollectionName) {
  return DG.currDocumentController().gameCollectionWithName( iGameName, iCollectionName);
};

/**
 * A global convenience function for dirtying the document.
 */
DG.dirtyCurrentDocument = function(changedObject) {
  // Tell the UndoHistory that something changed the document.
  // If this didn't occur inside a Command.execute, then it will clear
  // the undo stack.
  DG.UndoHistory.documentWasChanged();

  if (SC.none(changedObject)) {
    changedObject = DG.currDocumentController().get('content');
  }

  var update = function() {
    DG.currDocumentController().objectChanged(changedObject);
    DG.currDocumentController().incrementProperty('changeCount');
    //DG.log('changeCount = %@', DG.currDocumentController().get('changeCount'));
  };

  // Dirty the document after the current save finishes so that we don't miss sending to the server any changes that
  // didn't make it into this save cycle.
  var saveInProgress = DG.currDocumentController().get('saveInProgress');
  if (!SC.none(saveInProgress)) {
    saveInProgress.done(update);
  } else {
    update();
  }
};
