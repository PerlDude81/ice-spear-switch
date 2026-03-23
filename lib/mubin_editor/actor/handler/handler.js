/**
* @copyright 2018 - Max Bebök
* @author Max Bebök
* @license GNU-GPLv3 - see the "LICENSE" file in the root directory
*/

const uuid = require("uuid/v4");
const path = require("path");

const BYAML = require("byaml-lib");
const Main_Config  = require("../../../config/main_config");

const Actor        = require('../actor');
const Actor_Params = require('../params');
const Actor_Cache  = require('../cache/cache');
const Actor_Templates = require('../template');

const Actor_Object_Loader = require('../object/loader');
const Actor_Object_Handler = require('../object/handler');

const importActors = require("./importer");

const fs = require('fs');


var curMaxId = 0;

module.exports = class Actor_Handler
{
    /**
     * @param {Shrine_Renderer} mubinRenderer 
     * @param {Loader} loader 
     * @param {String_Table} stringTable 
     */
    constructor(mubinRenderer, project, loader, stringTable = null, mubinDir = null, mubinName = null)
    {
        this.mubinRenderer = mubinRenderer;
        this.loader = loader;
        this.stringTable = stringTable;

        this.editor = undefined;
        this.history = undefined;
        this._showLinks = false;

        this.actors = {};
        this.clear();

        const actorCache = new Actor_Cache(
            project.getCachePath(),
            project.mainConfig.getValue("cache.actors")
        );

        const cfg = new Main_Config();
        const actorPath  = cfg.getValue("game.updatePath") + "/content/Actor";
        const modelsPath = cfg.getValue("game.updatePath") + "/content/Model";
        const texturesPath = cfg.getValue("game.basePath") + "/content/Model";

        const actorObjLoader = new Actor_Object_Loader(actorPath, modelsPath, texturesPath, project, actorCache, this.mubinRenderer, this.loader, this.stringTable);
        this.actorObjHandler = new Actor_Object_Handler(actorObjLoader, this.mubinRenderer);

    }

    set showLinks(val) {
        this._showLinks = !!val;

        if(this._showLinks) {
            this.updateLinks();
        } else {
            this.clearLinks();
        }
    }

    async init()
    {
        await this.actorObjHandler.init();
    }

    update()
    {
        this.actorObjHandler.update();
    }

    updateLinks()
    {
        if(!this._showLinks) {
            return;
        }

        Object.values(this.actors).forEach(actor => 
        {
            if(actor.params.LinksToObj)
            {
                const scene = this.mubinRenderer.renderer.scene;

                actor.links.forEach(link => scene.remove(link));
                actor.links = [];

                actor.params.LinksToObj.forEach(link => {
                    const targetId = link.DestUnitHashId.value;
                    const linkedActor = this.getActorByHashId(targetId);
                    if (linkedActor) 
                    {
                        const material = new THREE.LineBasicMaterial({color: 0x0000ff});
                        var geometry = new THREE.Geometry();
                        geometry.vertices = [actor.objInstance.pos, linkedActor.objInstance.pos];

                        const line = new THREE.Line(geometry, material);
                        scene.add(line);
                        actor.links.push(line);
                    }
                });
            }
        });
    }

    clearLinks() 
    {
        Object.values(this.actors).forEach(
            actor => {
                actor.links.forEach(link => this.mubinRenderer.renderer.scene.remove(link));
                actor.links = [];
            }
        );
    }

    clear()
    {
        for(let actor of Object.values(this.actors))
        {
            actor.delete();
        }

        this.actors = {};
        this.dataActorDyn    = {};
        this.dataActorStatic = {};
        this.dataActorProd   = [];
    }

    setEditor(editor) 
    {
        this.editor = editor;
    }

    setHistory(history)
    {
        this.history = history;
    }

    getActorArray(type)
    {
        if(type === "Dynamic") {
            return this.dataActorDyn;
        } else if(type == "Static") {
            return this.dataActorStatic;
        } else if(parseInt(type) == type) {
            return this.dataActorProd[type];
        }
        console.error(`getActorArray: invalid type '${type}'`);
    }

    getActorByHashId(hashId)
    {
        return Object.values(this.actors).find(actor => actor.getHashId() == hashId);
    }

    getActorArrayObject(type)
    {
        if(type === "Dynamic") {
            return this.dataActorDyn.Objs;
        } else if(type == "Static") {
            return this.dataActorStatic.Objs;
        } else if(parseInt(type) == type) {
            return this.dataActorProd[type];
        }

        console.error(`getActorArrayObject: invalid type '${type}'`);
    }

    toJSON() {
        return JSON.stringify({
            dataActorDyn:    this.dataActorDyn,
            dataActorStatic: this.dataActorStatic,
            dataActorProd:   this.dataActorProd
        });
    }

    importJSON(data) {
        importActors(this, data);
    }

    /**
     * adds an actor (can be a mubin or PrOD object)
     * @param {string} name actor name
     * @param {Object} params BYAML params
     * @param {string|number} type "Dynamic"/"Static" or a number for PrOD files
     * @param {bool} alreadyIncluded if false, the params are added to the param object/array
     * @returns {Actor}
     */
    async addActor(name, params, type, alreadyIncluded = true)
    {
        const actorObjInstance = await this.actorObjHandler.createInstance(name);
        if(!actorObjInstance)
            return undefined;

        Actor_Params.normalize(params);

        const actor = new Actor(params, type, uuid(), actorObjInstance);
        actor.setHandler(this);

        if(alreadyIncluded)
        {
            switch(type)
            {
                case "Dynamic":
                    this.dataActorDyn.Objs.push(params);
                break;
                case "Static":
                    this.dataActorStatic.Objs.push(params);
                break;
                default: // PrOD
                    this.dataActorProd[type].push(params);
                break;
            }
        }

        this.actors[actor.id] = actor;
        actor.update();

        return actor;
    }


    /**
     * removes an actor, also removes it from all other places (editor, renderer, obj array)
     * @param {Actor} actor actor to remove
     * @returns {boolean} false if it was already removed / not set here
     */
    async deleteActor(actor)
    {
        const paramObj = this.getActorArrayObject(actor.type);
        const objIndex = paramObj.indexOf(actor.params);
        if(objIndex >= 0)
        {
            paramObj.splice(objIndex, 1);
        }else{
            console.warn("Removed Actor's params are not in the BYAML file!");
            console.warn(actor);
            return false;
        }

        this.deselectActor(actor);

        delete this.actors[actor.id];
        return true;
    }

    /**
     * deselects an actor
     * @param {Actor} actor to deselect
     */
    deselectActor(actor)
    {
        if(this.editor)
            this.editor.deselectActor(actor);
    }

    /** 
     * deselects an actor
     * @param {Actor} actor to deselect
     */
    focusActor(actor)
    {
        if(this.editor)
            this.editor.focusActor(actor);
    }

    /**
     * changes the actor type
     * @param {*} actor 
     * @param {*} type 
     */
    changeActorType(actor, type)
    {
        const oldType = type == "Dynamic" ? "Static" : "Dynamic";
        const arrayOld = this.getActorArray(oldType);
        const params = actor.params;

        // check if the actor is in the old array and also not in the new one
        if(!arrayOld.Objs.includes(params))
            return;

        const arrayNew = this.getActorArray(type);

        if(arrayNew.Objs.includes(params))
            return;

        // switch between arrays
        arrayOld.Objs = arrayOld.Objs.filter(a => a != params);
        arrayNew.Objs.push(params);

        this.history.add();
    }

    /**
     * copies an actor and adds it to the scene
     * @param {Actor} actor actor to copy
     * @returns {Actor} new actor
     */
    async copyActor(actor)
    {
        //console.log(actor);
        const paramCopy = BYAML.Helper.deepCopy(actor.params);

        if(paramCopy.Translate)
        {
            //paramCopy.Translate[0].value += 1.0;
        }

        paramCopy.HashId.value = this.getFreeHashId();
        const newActor = await this.addActor(actor.getName(), paramCopy, actor.type);
        this.history.add();

        if(this.editor) {
            this.editor.selectActor(newActor);
            this.editor.deselectActor(actor);
        }

        return newActor;
    }

    testChunkFile(varDir) {
        //console.log("varDir: "+varDir);

        var nameReg = new RegExp("\\\\field\\\\data\\\\","");
        var useChunkFile = false;
        if (nameReg.test(varDir)) {
                useChunkFile = true;
        }

        //console.log("useChunkFile:"+useChunkFile);
	return useChunkFile;
    }

    async addFromData(actorData, actorType = "Dynamic")
    {

	//console.log("mubin stuff: "+this.mubinDir+"/"+this.mubinName);

	//console.log("If you're seeing this, congrats for nerding out -or- thank you for trying to figure out what I've broken in this thing. -PerlDude");

        const actorName = actorData.UnitConfigName.value;
        const bymlParams = BYAML.Helper.deepCopy(actorData);
        const newActor = await this.addActor(actorName, bymlParams, actorType);

        if(newActor.getHashId() == 0) {
            newActor.setHashId(this.getFreeHashId(1,undefined));
        }

        this.history.add();

        if(this.editor) {
            newActor.move(this.editor.getCurrentPos());
            this.editor.selectActor(newActor);
        }
        
        return newActor;
    }

    async addFromTemplate(name)
    {
     	var actorData = await Actor_Templates.getData(name);

	if (this.testChunkFile(this.mubinDir)) {

        	// const hashIds = new Array(actorData.actors.length).fill(0).map((_, i) => i + this.getFreeHashId());

		var freeIds = this.getFreeHashId(actorData.actors.length,1);

		// To anyone trying to figure out what the f I'm doing here...
		//
		// The rest of this method is replacing link placeholders like {ID0} with the correct actor's id
		// First go through each actor in the template and make the replacement,
		// saving back the actorData each time.
		// Then go through the actors again, now that they have the correct object links,
		// and then set the actor's hash id and run addFromData on it.
		//
		// This original method won't work when operating from a distributed hash-ids file:
		//
		// const hashIds = new Array(actorData.actors.length).fill(0).map((_, i) => i + this.getFreeHashId());
		//

		actorData.actors.forEach((actorMe,idx) => {
			let actorDataStr = JSON.stringify(actorData);
			actorDataStr = actorDataStr.replace(new RegExp(`"\\{ID${idx}\\}"`, 'g'), freeIds[idx]);
			actorData = JSON.parse(actorDataStr);
		});


		actorData.actors.forEach((actorMe,idx) => {
			actorMe.HashId.value = freeIds[idx];
			//console.log(idx + ':' + actorMe.HashId.value);
			this.addFromData(actorMe, "Static");
		});

		// this.removeLinesFromFile(actorData.actors.length);

	} else {
	        const hashIds = new Array(actorData.actors.length).fill(0).map((_, i) => i + this.getFreeHashId());

        	let actorDataStr = JSON.stringify(actorData.actors);
        	hashIds.forEach((hashId, idx) => {
        	    actorDataStr = actorDataStr.replace(new RegExp(`"\\{ID${idx}\\}"`, 'g'), hashId)
        	});

        	JSON.parse(actorDataStr).forEach(actorData => {
        	    this.addFromData(actorData, "Static");
        	});

	}
    }

    getFreeHashId(howMany,forceArray) {
	if (this.testChunkFile(this.mubinDir)) {
		return this.getFreeHashLine(howMany,forceArray);
	} else {
        	const maxStatic = Math.max(...this.dataActorStatic.Objs.map(actor => actor.HashId.value));
        	const maxDyn    = Math.max(...this.dataActorDyn.Objs.map(actor => actor.HashId.value));
        	return Math.max(maxStatic, maxDyn) + 1;
	}
    }

    getFreeHashLine(howMany,forceArray) {
	var filePath = process.cwd()+"/free-hashes.txt";

	var varRet;

	//console.log("how many 1:"+howMany);

	if (howMany == undefined) {
		howMany = 1;
	}

	//console.log("how many 2:"+howMany);
	//console.log("force array:"+forceArray);

	var newIds = fs.readFileSync(filePath, 'utf8').split("\n");
	if (howMany == 1 && forceArray == undefined) {
		varRet = newIds[0];
		//console.log("How many in == 1: "+howMany);
		this.removeLinesFromFile(howMany);
		return varRet;
	} else {
		varRet = newIds.slice(0,howMany);
		//console.log("How many in not ==: "+howMany);
		this.removeLinesFromFile(howMany);
	}

	return varRet;
    }

    setMubinStuff(mubinDir,mubinName) {
            this.mubinDir = mubinDir;
            this.mubinName = mubinName;
    }


    removeLinesFromFile(numLines) {
		//console.log("numLines in removeLinesFromFile:"+numLines);

		var filePath = process.cwd()+"/free-hashes.txt";
                let idContent = fs.readFileSync(filePath).toString().split('\n'); 

		//console.log("Slicing lines: "+numLines);

                idContent = idContent.slice(numLines); 
                idContent = idContent.join('\n'); 
                fs.writeFileSync(filePath, idContent,'utf8');
    }


    getFreeHashId_with_digit()
    {
	//console.log("Current working directory:", process.cwd());

        const maxStatic = Math.max(...this.dataActorStatic.Objs.map(actor => actor.HashId.value));
        const maxDyn    = Math.max(...this.dataActorDyn.Objs.map(actor => actor.HashId.value));
        // return Math.max(maxStatic, maxDyn) + 1;

	var retId = Math.max(maxStatic, maxDyn) + 1;
	if (curMaxId > retId) {
		retId = curMaxId + 1;
	}
	var myDigit = 5;

	var digitMatcher = new RegExp(myDigit + "$");

	var isFound = digitMatcher.test(retId);

	//console.log("first: "+retId);
	//console.log("first: "+isFound);

	if (isFound == true) {
		isFound = false;
		curMaxId = retId;
		return retId;

	} else {

		do {
			retId += 1;
			isFound = digitMatcher.test(retId);
			//console.log("-----"+retId);
			//console.log("-----"+isFound);
		} while (isFound == false);

		isFound = false;
		curMaxId = retId;
		return retId;
	}
    }
    
    /**
     * refreshes the actor model by removing and adding it again
     * should be called after an actor object changed
     * @param {Actor} actor 
     */
    refreshActorRenderer(actor)
    {
        this.mubinRenderer.deleteActor(actor);
        this.mubinRenderer.addActor(actor);
    }

    /**
     * assigns a new param object to the actor and the internal BYAML data
     * @param {Actor} actor 
     * @param {Object} params 
     */
    assignNewActorParams(actor, params)
    {
        const dataObj = actor.type == "Dynamic" ? this.dataActorDyn.Objs : this.dataActorStatic.Objs;
        const dataIndex = dataObj.indexOf(actor.params);
        if(dataIndex < 0)
        {
            console.warn("Actor assign new params, actor has no params set in Objs!");
            return undefined;
        }

        dataObj[dataIndex] = params;
        actor.params = dataObj[dataIndex];
        
        return dataObj[dataIndex];
    }

    findActorDefinitions(name)
    {
        name = name.toLowerCase();
        return this.actorObjHandler.actorObjLoader.actorData.Actors.filter(
            entry => entry.name.value.toLowerCase().includes(name)
        );
    }
};
